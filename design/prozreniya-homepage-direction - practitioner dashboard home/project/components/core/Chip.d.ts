export interface ChipProps {
  /** @startingPoint section="Core" subtitle="Topic filter chip, selectable" viewport="700x120" */
  children: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}
