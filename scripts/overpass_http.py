"""Bounded retries for the map generator's explicitly read-only Overpass queries."""
import email.utils
import errno
import json
import random
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

RETRY_STATUS = {408, 429, 500, 502, 503, 504}
NETWORK_ERRNO = {errno.ECONNRESET, errno.ECONNREFUSED, errno.EPIPE, errno.ETIMEDOUT, errno.ENETUNREACH, errno.EHOSTUNREACH}


def retry_after(value, now):
    if not value:
        return None
    value = value.strip()
    if value.isascii() and value.isdigit():
        # Avoid both integer conversion limits and overflow; this wait will be declined.
        return float('inf') if len(value) > 12 else int(value)
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        return max(0, parsed.timestamp() - now) if parsed.tzinfo else None
    except (TypeError, ValueError, OverflowError):
        return None


def transient(error):
    if isinstance(error, ssl.SSLError):
        return False
    if isinstance(error, urllib.error.HTTPError):
        return error.code in RETRY_STATUS
    if isinstance(error, urllib.error.URLError):
        return transient(error.reason)
    if isinstance(error, socket.gaierror):
        return error.errno == socket.EAI_AGAIN
    return isinstance(error, (TimeoutError, socket.timeout)) or (isinstance(error, OSError) and error.errno in NETWORK_ERRNO)


def fetch_overpass(url, query, policy, user_agent, *, open_url=urllib.request.urlopen,
                   sleep=time.sleep, random_value=random.random, now=time.time, report=lambda _: None):
    # POST encodes a fixed read-only interpreter query; this is not a generic POST retry helper.
    for attempt in range(policy['attempts']):
        request = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode(),
                                         headers={'User-Agent': user_agent, 'Accept': 'application/json'})
        try:
            with open_url(request, timeout=policy['timeoutMs'] / 1000) as response:
                result = json.load(response)
                if not isinstance(result, dict) or not isinstance(result.get('elements'), list):
                    raise ValueError('Invalid Overpass response')
                return result['elements']
        except Exception as error:
            minimum = retry_after(error.headers.get('Retry-After'), now()) if isinstance(error, urllib.error.HTTPError) and error.headers else None
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            if not transient(error) or attempt + 1 >= policy['attempts']:
                raise RuntimeError('Overpass query failed') from None
            limit = policy['maxRetryWaitMs'] / 1000
            if minimum is not None and minimum > limit:
                raise RuntimeError('Overpass retry deferred by provider') from None
            base = min(limit, policy['retryMs'] / 1000 * 2 ** attempt)
            delay = max(minimum or 0, min(limit, base * (1 + random_value() * 0.25)))
            report('Overpass read temporarily unavailable; retrying')
            sleep(delay)
