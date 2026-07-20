interface TitleBarProps {
  title: string;
}

export default function TitleBar({ title }: TitleBarProps) {
  return (
    <div
      style={{
        height: 38,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px",
        background: "var(--slate-100)",
        borderBottom: "1px solid var(--border-subtle)"
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--fg-muted)",
          letterSpacing: "0.01em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {title}
      </div>
      <div style={{ width: 52 }} />
    </div>
  );
}
