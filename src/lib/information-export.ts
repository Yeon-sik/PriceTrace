import { Capacitor, registerPlugin } from "@capacitor/core";

const nativeExport = registerPlugin<{ saveRecord(options: { text: string; filename: string }): Promise<void> }>("InformationExport");

/** Pass the original JSON string through unchanged; numeric tokens must never be reserialized. */
export async function exportInformationRecord(text: string, id: string): Promise<void> {
  const filename = `${id}.information-record.json`;
  if (Capacitor.getPlatform() === "android") {
    await nativeExport.saveRecord({ text, filename });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
