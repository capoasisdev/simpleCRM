export default function Skeleton({
  width = '100%',
  height = '14px',
  borderRadius,
  circle = false,
  count = 1,
  className = '',
  style = {}
}) {
  const customStyle = {
    width: circle ? height : width,
    height,
    ...(borderRadius ? { borderRadius } : {}),
    ...style
  };

  if (count > 1) {
    return (
      <div className={`skeleton-group ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Array.from({ length: count }).map((_, idx) => (
          <span
            key={idx}
            className={`skeleton-shimmer ${circle ? 'circle' : ''}`}
            style={customStyle}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  return (
    <span
      className={`skeleton-shimmer ${circle ? 'circle' : ''} ${className}`}
      style={customStyle}
      aria-hidden="true"
    />
  );
}

