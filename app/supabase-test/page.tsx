"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { state: "loading" }
  | { state: "success"; message: string }
  | { state: "error"; message: string };

export default function SupabaseTestPage() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    const supabase = createClient();

    async function checkConnection() {
      try {
        const { error } = await supabase
          .from("__connection_check__")
          .select("*")
          .limit(1);

        if (!error) {
          setStatus({
            state: "success",
            message: "Connected to Supabase, and the table even exists!",
          });
          return;
        }

        // A "relation/table does not exist" error means the request
        // reached Supabase's API and was authenticated successfully —
        // that's exactly what we're testing for, since we don't expect
        // this table to be there yet.
        const tableMissing =
          error.code === "42P01" || /does not exist|not find the table/i.test(error.message);

        if (tableMissing) {
          setStatus({
            state: "success",
            message:
              "Connected to Supabase successfully (no tables yet, which is expected).",
          });
        } else {
          setStatus({
            state: "error",
            message: `Connected, but got an unexpected error: ${error.message}`,
          });
        }
      } catch (err) {
        setStatus({
          state: "error",
          message: `Failed to reach Supabase: ${(err as Error).message}`,
        });
      }
    }

    checkConnection();
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Supabase Connection Test</h1>
      {status.state === "loading" && <p>Checking connection…</p>}
      {status.state === "success" && (
        <p style={{ color: "green" }}>✅ {status.message}</p>
      )}
      {status.state === "error" && (
        <p style={{ color: "crimson" }}>❌ {status.message}</p>
      )}
    </main>
  );
}
