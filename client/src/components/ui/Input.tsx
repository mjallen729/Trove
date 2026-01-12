import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const baseInputClasses = `
      w-full px-4 py-2.5 bg-gray-800 border rounded-xl text-white text-sm
      placeholder:text-gray-500
      focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent
      transition-all duration-200
      disabled:opacity-50 disabled:cursor-not-allowed
    `;

    const borderClass = error
      ? "border-red-500 focus:ring-red-500"
      : "border-gray-700 hover:border-gray-600";

    const paddingClass = `${leftIcon ? "pl-10" : ""} ${rightIcon ? "pr-10" : ""}`;

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            className={`${baseInputClasses} ${borderClass} ${paddingClass} ${className}`}
            disabled={disabled}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
              {rightIcon}
            </div>
          )}
        </div>
        {(error || helperText) && (
          <p
            className={`mt-1.5 text-xs ${
              error ? "text-red-400" : "text-gray-500"
            }`}>
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
