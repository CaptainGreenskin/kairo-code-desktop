import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: boolean
}

const variantStyles: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface-2 text-text-primary border border-border hover:bg-surface-3',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-2',
  danger: 'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20'
}

const sizeStyles: Record<Size, string> = {
  sm: 'text-xs px-2 py-1 rounded-md gap-1',
  md: 'text-sm px-3 py-1.5 rounded-lg gap-1.5'
}

const iconSizeStyles: Record<Size, string> = {
  sm: 'w-7 h-7 rounded-md',
  md: 'w-8 h-8 rounded-lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', icon = false, className = '', children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none hover-lift'
    const v = variantStyles[variant]
    const s = icon ? iconSizeStyles[size] : sizeStyles[size]
    return (
      <button
        ref={ref}
        className={`${base} ${v} ${s} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
