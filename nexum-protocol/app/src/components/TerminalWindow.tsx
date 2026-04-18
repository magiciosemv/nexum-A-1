import { useEffect, useRef } from "react";

interface TerminalWindowProps {
  logs: string[];
}

export function TerminalWindow({ logs }: TerminalWindowProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="border border-green-900 bg-black rounded mt-6">
      <div className="border-b border-green-900 px-3 py-1 text-xs text-green-700 flex gap-2">
        <span className="w-3 h-3 rounded-full bg-red-700 inline-block" />
        <span className="w-3 h-3 rounded-full bg-yellow-700 inline-block" />
        <span className="w-3 h-3 rounded-full bg-green-700 inline-block" />
        <span className="ml-2">nexum-crypto-engine</span>
      </div>
      <div className="p-4 h-64 overflow-y-auto font-mono text-xs text-green-400">
        {logs.map((log, i) => (
          <div key={i} className="py-0.5 leading-relaxed">
            <span className="text-green-700">$ </span>{log}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-green-900">Waiting for operations...</div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
