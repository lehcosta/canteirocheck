import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 text-xs font-semibold tracking-[0.06em] uppercase whitespace-nowrap has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // pede decisão (ex.: aguardando liberação): laranja cheio, texto on-prumo
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        secondary: "bg-muted text-muted-foreground [a]:hover:bg-line/60",
        // fora da tolerância, bloqueada, recusada: sempre com ✕ ou a palavra
        destructive: "bg-muted text-divergencia [a]:hover:bg-line/60",
        // dentro da tolerância, liberada, aprovada: sempre com ✓ ou a palavra
        nivel: "bg-muted text-nivel [a]:hover:bg-line/60",
        // pendência, atenção sem bloqueio
        atencao: "bg-muted text-prumo-text [a]:hover:bg-line/60",
        outline: "border-concreto text-foreground [a]:hover:bg-muted",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-prumo-text underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
