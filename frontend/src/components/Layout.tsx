import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/feed", label: "피드" },
  { to: "/characters", label: "캐릭터" },
  { to: "/wardrobe", label: "옷장" },
  { to: "/mood", label: "무드" },
  { to: "/composer", label: "합성" },
  { to: "/log", label: "로그" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-30">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          <div className="flex items-center justify-between gap-3 h-14">
            <a
              href="/"
              className="flex items-center flex-shrink-0"
              aria-label="ModePick home"
            >
              <img src="/logo.png" alt="ModePick" className="h-6 sm:h-7 w-auto" />
            </a>
            <nav className="flex gap-0.5 sm:gap-1 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) =>
                    `px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-md whitespace-nowrap transition-colors ${
                      isActive
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  );
}
