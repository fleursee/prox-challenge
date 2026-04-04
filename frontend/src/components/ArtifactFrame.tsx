interface Props {
    artifactType: "html" | "svg";
    code: string;
  }
  
  export function ArtifactFrame({ artifactType, code }: Props) {
    const html =
      artifactType === "svg"
        ? `<!DOCTYPE html><html><body style="margin:0;background:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh">${code}</body></html>`
        : code;
  
    return (
      <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg mt-2">
        <div className="bg-white/5 px-4 py-2 text-xs text-white/40 font-mono border-b border-white/10">
          {artifactType === "svg" ? "diagram" : "interactive"}
        </div>
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full"
          style={{ height: "420px", border: "none", background: "#1a1a1a" }}
          title="artifact"
        />
      </div>
    );
  }