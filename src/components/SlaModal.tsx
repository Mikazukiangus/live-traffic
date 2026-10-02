import React, { useState } from 'react';

interface SlaModalProps {
  isOpen: boolean;
  onClose: () => void;
  locationMarker: string;
}

export const SlaModal: React.FC<SlaModalProps> = ({ isOpen, onClose, locationMarker }) => {
  const [carrier, setCarrier] = useState('GrabExpress / Lalamove');
  const [manifestId, setManifestId] = useState('SG-DELIV-9824-X');
  const [parcelsCount, setParcelsCount] = useState('14');
  const [isLogged, setIsLogged] = useState(false);
  const [logCert, setLogCert] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const certNumber = `LTA-SLA-CERT-${Date.now().toString().slice(-6)}`;
    setLogCert(certNumber);
    setIsLogged(true);
  };

  const reset = () => {
    setIsLogged(false);
    setLogCert(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 sm:p-6 flex flex-col gap-4 shadow-2xl relative">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-sky-600">
            <span className="material-symbols-outlined text-2xl">local_shipping</span>
            <h3 className="text-base sm:text-lg text-slate-900 font-bold">
              Fleet Courier SLA Cargo Protection
            </h3>
          </div>
          <button
            onClick={reset}
            className="p-1 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {!isLogged ? (
          <form onSubmit={handleGenerate} className="flex flex-col gap-3.5">
            <p className="text-xs text-slate-600 leading-relaxed">
              Generate an official LTA EMAS verified expressway delay affidavit to legally protect
              your carrier SLA penalties and notify backup fleet dispatchers.
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-700 font-semibold">Carrier / Fleet Operator</label>
              <select
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 text-xs focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              >
                <option>GrabExpress / Lalamove</option>
                <option>Ninja Van Singapore</option>
                <option>J&amp;T Express / Shopee Express</option>
                <option>SingPost Speedpost</option>
                <option>DHL Express / FedEx Priority</option>
                <option>Private Heavy Haulage Logistics</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-700 font-semibold">Manifest / Job ID</label>
                <input
                  type="text"
                  value={manifestId}
                  onChange={(e) => setManifestId(e.target.value)}
                  required
                  className="w-full h-10 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 text-xs font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-700 font-semibold">Parcels Affected</label>
                <input
                  type="number"
                  value={parcelsCount}
                  onChange={(e) => setParcelsCount(e.target.value)}
                  required
                  className="w-full h-10 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 text-xs font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
              <span className="font-semibold text-slate-800">Telemetry Pinned Location:</span>
              <div className="font-mono text-slate-700 mt-0.5">{locationMarker}</div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                Issue SLA Protection Certificate
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3.5 py-2">
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl flex flex-col gap-2">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                <span className="material-symbols-outlined text-lg">verified</span>
                <span>LTA Verified Breakdown Affidavit Issued</span>
              </div>
              <div className="font-mono text-xs text-emerald-950 bg-white p-2.5 rounded border border-emerald-200 flex flex-col gap-1">
                <div>
                  <span className="text-slate-500">Cert #:</span> <strong>{logCert}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Carrier:</span> {carrier}
                </div>
                <div>
                  <span className="text-slate-500">Manifest:</span> {manifestId} ({parcelsCount}{' '}
                  parcels)
                </div>
                <div>
                  <span className="text-slate-500">Expressway Telemetry:</span> {locationMarker}
                </div>
                <div>
                  <span className="text-slate-500">Timestamp:</span> {new Date().toLocaleString()}
                </div>
              </div>
              <p className="text-[11px] text-emerald-700">
                Official electronic timestamp stored with TrafficPulse Logistics Network. Carrier
                SLA penalties are suspended during verified recovery window.
              </p>
            </div>

            <button
              onClick={reset}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Done &amp; Return to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
