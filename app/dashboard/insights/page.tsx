import { BarChart3 } from "lucide-react";

export default function InsightsPage() {
  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-40 h-20 px-4 md:px-8 flex flex-col md:flex-row md:items-center justify-between shadow-sm border-b border-light-clinical-gray bg-light-background">
        <div className="hidden md:block">
          <h1 className="font-sans text-4xl font-medium text-gray-900 tracking-wide leading-none">
            Insights
          </h1>
        </div>
        <div className="md:hidden pt-2 pb-1">
          <h1 className="font-sans text-xl font-medium text-gray-900 tracking-wide leading-none">
            Insights
          </h1>
        </div>
      </header>

      <div className="p-4 md:p-8 relative z-0">
        <div className="max-w-[1400px] mx-auto space-y-6 pb-10">
          <div className="bg-white border border-light-clinical-gray rounded-xl shadow-sm p-12 text-center mt-10 relative overflow-hidden group">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-light-primary/5 rounded-full blur-[80px] pointer-events-none group-hover:bg-light-primary/10 transition-colors duration-700"></div>
            <div className="relative z-10">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-light-primary/10 text-light-primary mb-6 border border-light-primary/20">
                <BarChart3 className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-sans font-semibold text-gray-900 mb-4">
                Hamarosan érkezik
              </h2>
              <p className="text-gray-500 max-w-lg mx-auto leading-relaxed text-sm">
                A részletes statisztikák és elemzések modulunk jelenleg tervezés
                alatt áll. Hamarosan láthatod a posztjaid teljesítményét egy
                helyen.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
