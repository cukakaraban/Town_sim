import React from 'react';

export type AppScreen = 'map' | 'locations' | 'gallery' | 'verification';

interface TopBarProps {
  activeScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  onRandomizeTown: () => void;
  isGenerating: boolean;
}

const NAV_ITEMS: Array<{ id: AppScreen; label: string }> = [
  { id: 'map', label: 'Map' },
  { id: 'locations', label: 'Locations' },
  { id: 'gallery', label: 'Seed Gallery' },
  { id: 'verification', label: 'Verification' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeScreen,
  onNavigate,
  onRandomizeTown,
  isGenerating,
}) => {
  return (
    <header className="shrink-0 bg-[#FAF9F6] border-b border-[#DCD9D0]">
      <div className="h-12 md:h-14 px-4 md:px-6 flex items-center justify-between gap-3 md:gap-8">
        <button
          type="button"
          onClick={() => onNavigate('map')}
          className="font-display text-base md:text-lg font-semibold tracking-tight text-[#1C1F23] whitespace-nowrap shrink-0 cursor-pointer hover:text-[#1D4E5F] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4E5F]"
        >
          Second Helpings Atlas
        </button>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
          {NAV_ITEMS.map((item) => {
            const active = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative py-4 text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4E5F] ${
                  active
                    ? 'text-[#1D4E5F]'
                    : 'text-[#5A626D] hover:text-[#1C1F23]'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-[#1D4E5F]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onRandomizeTown}
            disabled={isGenerating}
            className="px-3.5 md:px-4 py-1.5 md:py-2 rounded-md bg-[#1D4E5F] text-white text-xs md:text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer hover:bg-[#163D4B] disabled:opacity-60 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4E5F]"
          >
            {isGenerating ? 'Generating...' : 'New Seed'}
          </button>
        </div>
      </div>

      <nav
        aria-label="Mobile Primary"
        className="flex md:hidden items-center justify-around border-t border-[#EAE8E1] px-2 h-9"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeScreen === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`relative h-full px-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                active
                  ? 'text-[#1D4E5F]'
                  : 'text-[#5A626D] hover:text-[#1C1F23]'
              }`}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1 bottom-0 h-0.5 bg-[#1D4E5F]"
                />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
