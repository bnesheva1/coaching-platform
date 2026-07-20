export interface CardProps {
  /** @startingPoint section="Core" subtitle="Value-prop / content card, surface or inverse tone" viewport="700x260" */
  eyebrow?: string;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  tone?: 'surface' | 'inverse';
}
