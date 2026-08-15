"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

// Manual refresh for the health page. router.refresh() re-runs the (force-
// dynamic) server component, so every check runs again live — no client fetch,
// no cached data. Disabled + relabelled while the refresh is in flight.
export function HealthRefreshButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
