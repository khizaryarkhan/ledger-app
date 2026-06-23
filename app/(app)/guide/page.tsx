"use client";

import { useEffect, useState } from "react";
import { GuideLayout, type GuideContent } from "@/components/guide";
import { DEFAULT_CUSTOMER_GUIDE } from "@/lib/guide-content";

export default function CustomerGuidePage() {
  const [guide, setGuide] = useState<GuideContent>(DEFAULT_CUSTOMER_GUIDE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/guide/customer")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.sections) setGuide(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-5 py-8">
        <div className="h-8 w-48 bg-stone-800 rounded animate-pulse mb-6" />
        <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-stone-900 rounded-lg animate-pulse" />)}</div>
      </div>
    );
  }

  return <GuideLayout title={guide.title} subtitle={guide.subtitle} sections={guide.sections} />;
}
