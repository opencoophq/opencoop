export function AnimatedGridBg() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="absolute inset-0 opacity-[0.03]">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <div
        className="absolute top-1/4 -left-32 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
        style={{ background: 'hsl(221.2, 83.2%, 53.3%)' }}
      />
      <div
        className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] rounded-full opacity-10 blur-[100px]"
        style={{ background: 'hsl(221.2, 83.2%, 53.3%)' }}
      />
    </div>
  );
}
