import { useState } from "react";
import type { FilePatch } from "./parse.ts";

const LIMIT = 1500;

export function TextDiff({ file }: { file: FilePatch }) {
  const [showAll, setShowAll] = useState(false);
  if (file.binary) return <div className="empty">二进制文件</div>;
  if (file.hunks.length === 0) return <div className="empty">无文本改动（可能只是重命名或权限变化）</div>;
  const total = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  let budget = showAll ? Infinity : LIMIT;
  return (
    <div className="text-diff">
      <table>
        <tbody>
          {file.hunks.map((h, hi) => {
            if (budget <= 0) return null;
            const lines = h.lines.slice(0, budget);
            budget -= lines.length;
            return [
              <tr key={`h${hi}`} className="hunk">
                <td colSpan={3}>{h.header}</td>
              </tr>,
              ...lines.map((l, li) => (
                <tr key={`${hi}-${li}`} className={`ln ${l.kind}`}>
                  <td className="no">{l.oldNo ?? ""}</td>
                  <td className="no">{l.newNo ?? ""}</td>
                  <td className="code">
                    <span className="sign">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
                    {l.text}
                  </td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
      {!showAll && total > LIMIT && (
        <button className="more" onClick={() => setShowAll(true)}>
          还有 {total - LIMIT} 行未显示，全部展开
        </button>
      )}
    </div>
  );
}
