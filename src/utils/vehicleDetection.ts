/** Compatibility entry point; runtime loading and React scheduling have separate owners. */
export { countVehicles, vehicleCountingAllowed } from '../features/vehicle-counting/engine';
export { useVehicleCounts, currentVehicleCount } from '../features/vehicle-counting/useVehicleCounts';
export type { VehicleCount, VehicleCountStatus } from '../features/vehicle-counting/useVehicleCounts';
