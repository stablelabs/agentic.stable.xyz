// Adapted from shadcn/ui (MIT): https://ui.shadcn.com
import * as React from 'react';
import { cn } from '../../lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-none border-0 border-b border-input bg-transparent px-0 py-2 text-base text-primary transition-[border-color,box-shadow] duration-200 outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[color:var(--ink-30)] hover:border-primary hover:shadow-[0_2px_0_0_var(--accent)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-primary focus-visible:shadow-[0_2px_0_0_var(--accent)]',
        'aria-invalid:border-destructive aria-invalid:shadow-[0_2px_0_0_var(--danger)]',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
