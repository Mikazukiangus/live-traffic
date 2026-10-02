import React, { useState } from 'react';
import { ActiveDispatch } from '../types/traffic';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  workshopName: string;
  pricingText: string;
  currentMarker: string;
  onConfirmDispatch: (dispatch: ActiveDispatch) => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  isOpen,
  onClose,
  workshopName,
  pricingText,
  currentMarker,
  onConfirmDispatch,
}) => {
  const [plate, setPlate] = useState('SLL 8492 K');
  const [vehicleClass, setVehicleClass] = useState('Sedan / Hatchback');
  const [phone, setPhone] = useState('+65 9123 4567');
  const [specialRemarks, setSpecialRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    setTimeout(() => {
      const newDispatch: ActiveDispatch = {
        id: `DSP-${Date.now().toString().slice(-6)}`,
        triageTitle: 'Emergency Recovery Request',
        workshopName: workshopName || 'Kaki Bukit Autowerks Hub',
        vehiclePlate: plate.trim().toUpperCase(),
        vehicleClass,
        contactPhone: phone,
        locationMarker: currentMarker,
        unitCode: 'Unit T-09',
        truckPlate: 'XD 4921 B',
        driverName: 'Tan Ah Huat (FleetCare 24)',
        driverPhone: '+65 9182 3421',
        etaMins: 6,
        step: 'assigned',
        costText: pricingText,
        createdAt: new Date().toLocaleTimeString(),
      };

      onConfirmDispatch(newDispatch);
      setSubmitting(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 sm:p-6 flex flex-col gap-4 shadow-2xl relative">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-sky-600">
            <span className="material-symbols-outlined text-2xl">assignment_turned_in</span>
            <h3 className="text-base sm:text-lg text-slate-900 font-bold">
              Instant Dispatch Bay Reservation
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Selected Hub Summary */}
        <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg flex flex-col gap-1">
          <span className="text-[11px] text-slate-500 uppercase font-semibold">
            Target Facility:
          </span>
          <span className="font-bold text-slate-900 text-sm sm:text-base">{workshopName}</span>
          <span className="text-emerald-700 font-mono text-xs font-semibold">
            {pricingText} • LTA Verified Flat Rate
          </span>
        </div>

        {/* Booking Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-700 font-semibold flex items-center justify-between">
              <span>Vehicle License Plate</span>
              <span className="text-slate-400 font-normal text-[11px]">Format: SG / MY Registered</span>
            </label>
            <input
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="e.g. SLL 8492 K"
              required
              className="w-full h-11 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 font-mono text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 uppercase tracking-wider"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-700 font-semibold">Vehicle Class</label>
              <select
                value={vehicleClass}
                onChange={(e) => setVehicleClass(e.target.value)}
                className="w-full h-11 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              >
                <option>Sedan / Hatchback</option>
                <option>SUV / MPV</option>
                <option>Commercial Van</option>
                <option>Heavy Lorry / Truck</option>
                <option>Electric Vehicle (EV)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-700 font-semibold">Mobile Contact</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+65 9123 4567"
                required
                className="w-full h-11 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-700 font-semibold">
              Additional Details (Optional)
            </label>
            <input
              type="text"
              value={specialRemarks}
              onChange={(e) => setSpecialRemarks(e.target.value)}
              placeholder="e.g. Steering locked, low clearance front lip..."
              className="w-full h-10 px-3 rounded-lg bg-white border border-slate-300 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            />
          </div>

          {/* GPS Marker Pinned */}
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-sky-600 shrink-0">
              gps_fixed
            </span>
            <span className="truncate">Pinned pickup: {currentMarker}</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {submitting && (
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
              )}
              <span>{submitting ? 'Transmitting Dispatch...' : 'Confirm & Send Tow'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
