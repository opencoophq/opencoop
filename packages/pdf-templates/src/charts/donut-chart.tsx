import React from 'react';
import { Svg, Path, G, View, Text, StyleSheet } from '@react-pdf/renderer';
import { CHART_COLORS } from './colors';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 8,
    gap: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendText: {
    fontSize: 8,
    color: '#555555',
  },
});

export interface DonutChartProps {
  data: { label: string; value: number }[];
  size?: number;
  innerRadius?: number;
  outerRadius?: number;
  formatValue?: (n: number) => string;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const startOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const startInner = polarToCartesian(cx, cy, innerR, startAngle);
  const endInner = polarToCartesian(cx, cy, innerR, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

export const DonutChart: React.FC<DonutChartProps> = ({
  data,
  size = 150,
  innerRadius = 40,
  outerRadius = 65,
  formatValue,
}) => {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0 || data.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;

  const slices: { d: string; color: string }[] = [];
  let currentAngle = 0;

  data.forEach((item, i) => {
    const sliceAngle = (item.value / total) * 360;
    if (sliceAngle === 0) return;

    // Handle full circle (single item) — split into two semicircles
    if (sliceAngle >= 359.99) {
      slices.push({
        d: describeArc(cx, cy, outerRadius, innerRadius, 0, 179.99),
        color: CHART_COLORS[i % CHART_COLORS.length],
      });
      slices.push({
        d: describeArc(cx, cy, outerRadius, innerRadius, 180, 359.98),
        color: CHART_COLORS[i % CHART_COLORS.length],
      });
    } else {
      slices.push({
        d: describeArc(cx, cy, outerRadius, innerRadius, currentAngle, currentAngle + sliceAngle),
        color: CHART_COLORS[i % CHART_COLORS.length],
      });
    }
    currentAngle += sliceAngle;
  });

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G>
          {slices.map((slice, i) => (
            <Path key={i} d={slice.d} fill={slice.color} />
          ))}
        </G>
      </Svg>
      <View style={styles.legend}>
        {data.map((item, i) => {
          const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
          const valueStr = formatValue ? formatValue(item.value) : String(item.value);
          return (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
              <Text style={styles.legendText}>
                {item.label} — {valueStr} ({pct}%)
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};
