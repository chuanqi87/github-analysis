'use client';

function colorFor(score: number): string {
  if (score >= 60) return '#cf1322';
  if (score >= 40) return '#d46b08';
  if (score >= 20) return '#d4b106';
  return '#8c8c8c';
}

export default function ScoreBar({ score }: { score: number | null | undefined }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div className="score-bar">
      <div className="score-bar__track">
        <div
          className="score-bar__fill"
          style={{ width: `${value}%`, background: colorFor(value) }}
        />
      </div>
      <span className="score-bar__num">{value.toFixed(1)}</span>
    </div>
  );
}
