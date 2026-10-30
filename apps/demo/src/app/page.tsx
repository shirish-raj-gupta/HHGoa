import { Eyebrow, ShaderBackdrop } from '@receipts/react';
import { Stage } from '@/components/stage';

export default function StagePage() {
  return (
    <div className="space-y-8">
      <div className="relative isolate space-y-3 py-4">
        <div aria-hidden className="absolute -top-24 -bottom-10 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden">
          <ShaderBackdrop className="h-full w-full" />
          <div className="grain absolute inset-0" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-bg" />
        </div>
        <Eyebrow>Live demo</Eyebrow>
        <h1 className="text-4xl leading-[1.05] font-extrabold sm:text-6xl">
          Same question. Same model.
          <br />
          <span className="font-serif font-normal text-good italic">Different sources.</span>
        </h1>
      </div>
      <Stage />
    </div>
  );
}
