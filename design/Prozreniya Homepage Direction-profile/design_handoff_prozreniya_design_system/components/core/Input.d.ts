export interface InputProps {
  /** @startingPoint section="Core" subtitle="Text field and hero search variant" viewport="700x200" */
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  helperText?: string;
  search?: boolean;
  onSearch?: () => void;
}
