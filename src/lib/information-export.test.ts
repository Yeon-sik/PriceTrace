import { afterEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ getPlatform: vi.fn(() => "android"), saveRecord: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: native.getPlatform }, registerPlugin: () => ({ saveRecord: native.saveRecord }) }));
import { exportInformationRecord } from "./information-export";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); native.saveRecord.mockReset(); native.getPlatform.mockReturnValue("android"); });

describe("information record export", () => {
  const text = '{ "exact": 90071992547409931234567890, "decimal": "1.0000" }\n';
  it("passes exact source text to Android document creation", async () => {
    native.saveRecord.mockResolvedValueOnce(undefined);
    await exportInformationRecord(text, "record-id");
    expect(native.saveRecord).toHaveBeenCalledExactlyOnceWith({ text, filename: "record-id.information-record.json" });
  });
  it("propagates cancellation and write failure without a false browser fallback", async () => {
    for (const message of ["내보내기를 취소했습니다.", "선택한 파일에 쓰지 못했습니다."]) {
      native.saveRecord.mockRejectedValueOnce(new Error(message));
      await expect(exportInformationRecord(text, "record-id")).rejects.toThrow(message);
    }
  });
  it("downloads the same bytes in browsers and releases the temporary URL", async () => {
    native.getPlatform.mockReturnValue("web"); vi.useFakeTimers();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    await exportInformationRecord(text, "record-id");
    expect(await (create.mock.calls[0][0] as Blob).text()).toBe(text);
    expect(anchor.download).toBe("record-id.information-record.json"); expect(anchor.click).toHaveBeenCalledOnce();
    expect(native.saveRecord).not.toHaveBeenCalled();
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
