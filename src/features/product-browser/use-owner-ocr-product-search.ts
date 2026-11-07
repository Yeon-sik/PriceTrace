import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type Product = Pick<Database["public"]["Tables"]["product_identity_candidates"]["Row"],
