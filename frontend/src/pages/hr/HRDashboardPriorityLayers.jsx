import React from 'react';
import { AlertTriangle, CalendarClock, Bell } from 'lucide-react';
import { PRIORITY_TIERS, sortAggregateCards } from './dashboardCommandCenter';
import HRDashboardAggregateCard from './HRDashboardAggregateCard';

const TIER_ICONS = {
  urgent: AlertTriangle,
  attention: Bell,
  upcoming: CalendarClock,
};

export default function HRDashboardPriorityLayers({ tiers, loading }) {
  if (loading) return null;

  const sections = [
    { tier: PRIORITY_TIERS.urgent, cards: sortAggregateCards(tiers?.urgent || []) },
    { tier: PRIORITY_TIERS.attention, cards: sortAggregateCards(tiers?.attention || []) },
    { tier: PRIORITY_TIERS.upcoming, cards: sortAggregateCards(tiers?.upcoming || []) },
  ].filter((section) => section.cards.length > 0);

  if (sections.length === 0) return null;

  return (
    <div className="space-y-4">
      {sections.map(({ tier, cards }) => {
        const Icon = TIER_ICONS[tier.id] || Bell;
        return (
          <section
            key={tier.id}
            className={`rounded-2xl border p-5 ${tier.accent}`}
          >
            <div className="mb-4">
              <h2 className={`flex items-center gap-2 text-base font-bold ${tier.titleClass}`}>
                <Icon size={18} />
                {tier.label}
              </h2>
              <p className="mt-0.5 text-sm opacity-80">{tier.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <HRDashboardAggregateCard key={card.id} card={card} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
