// Corner review is mounted independently of the analyzer's lap A/B selection.
let selection: {
  cornerId: string;
  snapshotId: string;
  referenceLapId: string;
  comparisonLapId?: string;
} | null = null;
let revision = 0;
export const reviewSelection = {
  get: () => selection,
  revision: () => revision,
  set(value: typeof selection) {
    selection = value;
    revision++;
  },
};
