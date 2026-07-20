export interface ButtonProps {
  /** @startingPoint section="Core" subtitle="Primary, secondary and ghost actions" viewport="700x220" */
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  children: React.ReactNode;
}
