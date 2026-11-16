import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding font-semibold whitespace-nowrap transition-colors select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // laranja só para a ação principal da tela (uma por tela); texto sempre on-prumo
        default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--prumo),var(--ink)_10%)]",
        outline: "border-concreto bg-card text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-muted text-foreground hover:bg-line/70 aria-expanded:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted",
        destructive: "border-divergencia bg-card text-divergencia hover:bg-[color-mix(in_oklch,var(--divergencia),transparent_94%)]",
        link: "text-prumo-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 gap-2 px-4 text-[15px]",
        xs: "h-7 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-5 text-base",
        icon: "size-10",
        "icon-xs": "size-7 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
