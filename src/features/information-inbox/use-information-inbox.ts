"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { InformationInboxRepository, type InformationInboxEntry } from "@/repositories/information-inbox.repository";
import type { InformationInboxState } from "@/domain/information-record";

export function useInformationInbox(authRevision: number) {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(() => client ? new InformationInboxRepository(client) : null, [client]);
  const generation = useRef(0);
  const [entries, setEntries] = useState<InformationInboxEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasMore, setHasMore] = useState(false);

  const reload = useCallback(async (offset = 0) => {
    const current = generation.current;
    setBusy(true); setError("");
    try {
      if (!repository) throw new Error("この環境では接続設定がありません。".replace("この環境では接続設定がありません。", "이 환경에는 서버 연결 설정이 없습니다."));
      const page = await repository.list(offset);
      if (current !== generation.current) return;
      setEntries(previous => offset ? [...previous, ...page.filter(row => !previous.some(item => item.record_id === row.record_id))] : page);
      setHasMore(page.length === 50);
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "불러오기에 실패했습니다."); }
    finally { if (current === generation.current) setBusy(false); }
  }, [repository]);

  useEffect(() => {
    generation.current += 1;
    setEntries([]); setNotice(""); setHasMore(false);
    void reload();
    return () => { generation.current += 1; };
  }, [authRevision, reload]);

  const save = async (text: string) => {
    const current = generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!repository) throw new Error("이 환경에는 서버 연결 설정이 없습니다.");
      const result = await repository.importText(text);
      if (current !== generation.current) return false;
      setNotice(result.duplicate ? "이미 보관된 같은 기록입니다. 중복 저장하지 않았습니다." : "내 비공개 보관함에 저장했습니다.");
      await reload(); return true;
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "저장하지 못했습니다."); return false; }
    finally { if (current === generation.current) setBusy(false); }
  };

  const setState = async (id: string, state: InformationInboxState) => {
    const current = generation.current;
    setBusy(true); setError("");
    try {
      if (!repository) throw new Error("이 환경에는 서버 연결 설정이 없습니다.");
      await repository.setState(id, state);
      if (current === generation.current) setEntries(previous => previous.map(row => row.record_id === id ? { ...row, state } : row));
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "상태를 변경하지 못했습니다."); }
    finally { if (current === generation.current) setBusy(false); }
  };
  return { entries, busy, error, notice, hasMore, reload, save, setState };
}
