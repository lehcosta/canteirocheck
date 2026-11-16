"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function BotaoSair() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Sair"
      title="Sair"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut aria-hidden className="size-5" />
    </Button>
  );
}
