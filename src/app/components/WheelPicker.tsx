'use client';

import { useMemo } from 'react';
import WheelPickerColumn from './WheelPickerColumn';

interface WheelPickerProps {
  years: number;
  months: number;
  days: number;
  onChange: (value: { years: number; months: number; days: number }) => void;
}

export default function WheelPicker({
  years,
  months,
  days,
  onChange,
}: WheelPickerProps) {
  // Generate values arrays
  const yearsValues = useMemo(() => Array.from({ length: 11 }, (_, i) => i), []);
  const monthsValues = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);
  const daysValues = useMemo(() => Array.from({ length: 31 }, (_, i) => i), []);

  const handleYearsChange = (newYears: number) => {
    onChange({ years: newYears, months, days });
  };

  const handleMonthsChange = (newMonths: number) => {
    onChange({ years, months: newMonths, days });
  };

  const handleDaysChange = (newDays: number) => {
    onChange({ years, months, days: newDays });
  };

  return (
    <div className="wheel-picker">
      <WheelPickerColumn
        values={yearsValues}
        value={years}
        onChange={handleYearsChange}
        label="Годы"
        suffix="лет"
      />
      <WheelPickerColumn
        values={monthsValues}
        value={months}
        onChange={handleMonthsChange}
        label="Месяцы"
        suffix="мес."
      />
      <WheelPickerColumn
        values={daysValues}
        value={days}
        onChange={handleDaysChange}
        label="Дни"
        suffix="дн."
      />
    </div>
  );
}

