export default function LaterOnView() {
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 64px)', overflow: 'hidden', background: '#ffffff' }}>
      <iframe
        src="https://lateron.capoasis.com/dashboard"
        title="LaterOn Automation"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block'
        }}
        allow="clipboard-read; clipboard-write; camera; microphone"
      />
    </div>
  );
}
