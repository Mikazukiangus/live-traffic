import io
import json
import pathlib
import socket
import ssl
import sys
import unittest
import urllib.error
from email.message import Message

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))
from overpass_http import fetch_overpass


class OverpassRetryTests(unittest.TestCase):
    def harness(self, answers, **overrides):
        calls, sleeps, reports = [], [], []
        policy = dict(attempts=4, timeoutMs=1000, retryMs=400, maxRetryWaitMs=2000)
        policy.update(overrides)

        def open_url(request, timeout):
            calls.append((request, timeout))
            answer = answers[min(len(calls) - 1, len(answers) - 1)]
            if isinstance(answer, Exception):
                raise answer
            return io.BytesIO(json.dumps(answer).encode())

        def run():
            return fetch_overpass('https://example.test/interpreter', '[out:json];node(1);out;', policy, 'synthetic-agent',
                                  open_url=open_url, sleep=sleeps.append, random_value=lambda: 1, now=lambda: 1000,
                                  report=reports.append)
        return run, calls, sleeps, reports

    def http_error(self, code, retry_after=None):
        headers = Message()
        if retry_after is not None:
            headers['Retry-After'] = retry_after
        return urllib.error.HTTPError('https://example.test/private-marker', code, 'private-marker', headers, io.BytesIO(b'private-marker'))

    def test_transient_read_only_post_recovers_with_exponential_jitter_and_exact_request(self):
        run, calls, sleeps, _ = self.harness([self.http_error(503), self.http_error(503), self.http_error(500), {'elements': []}])
        self.assertEqual(run(), [])
        self.assertEqual(sleeps, [0.5, 1.0, 2.0])
        self.assertTrue(all(request.get_method() == 'POST' and timeout == 1 for request, timeout in calls))
        self.assertTrue(all(request.data == calls[0][0].data for request, _ in calls))

    def test_permanent_errors_malformed_data_and_tls_never_retry_or_log_provider_text(self):
        for error in [self.http_error(401), self.http_error(403), self.http_error(404), self.http_error(501),
                      ssl.SSLCertVerificationError('private-marker'), urllib.error.URLError('private-marker'),
                      {'bad': 'private-marker'}]:
            run, calls, sleeps, reports = self.harness([error])
            with self.assertRaises(RuntimeError) as result:
                run()
            self.assertEqual(len(calls), 1)
            self.assertEqual(sleeps, [])
            self.assertNotIn('private-marker', str(result.exception) + str(reports))

    def test_retry_after_minimum_and_long_wait_deferral(self):
        run, calls, sleeps, _ = self.harness([self.http_error(429, '2'), {'elements': []}])
        self.assertEqual(run(), [])
        self.assertEqual(sleeps, [2])
        for hint in ['60', '9' * 5000]:
            run, calls, sleeps, _ = self.harness([self.http_error(503, hint)])
            with self.assertRaises(RuntimeError):
                run()
            self.assertEqual(len(calls), 1)
            self.assertEqual(sleeps, [])

    def test_transient_socket_failure_retries_but_exhaustion_has_no_final_sleep(self):
        run, calls, sleeps, _ = self.harness([urllib.error.URLError(socket.timeout()), {'elements': []}])
        self.assertEqual(run(), [])
        self.assertEqual(len(calls), 2)
        run, calls, sleeps, _ = self.harness([self.http_error(503)], attempts=2)
        with self.assertRaises(RuntimeError):
            run()
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(sleeps), 1)


if __name__ == '__main__':
    unittest.main()
