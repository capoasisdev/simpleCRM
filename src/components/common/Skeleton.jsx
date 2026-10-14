export default function Skeleton({
  width = '100%',
  height = '14px',
  borderRadius,
  circle = false,
  className = '',
  style = {}
}) {
  const customStyle = {
    width: circle ? height : width,
    height,
    ...(borderRadius ? { borderRadius } : {}),
    ...style
  };

  return (
    <span
      className={`skeleton-shimmer ${circle ? 'circle' : ''} ${className}`}
      style={customStyle}
      aria-hidden="true"
    />
  );
}
