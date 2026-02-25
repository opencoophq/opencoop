import React from 'react';
import { Svg, Path, Line, G, Rect, View, Text, StyleSheet } from '@react-pdf/renderer';
import { CHART_COLORS } from './colors';

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 3,
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

export interface StackedAreaDataPoint {
  date: string;
  values: { key: string; label: string; value: number }[];
  total: number;
}

export interface StackedAreaChartProps {
  data: StackedAreaDataPoint[];
  width?: number;
  height?: number;
  formatValue?: (n: number) => string;
  formatDate?: (date: string) => string;
}

export const StackedAreaChart: React.FC<StackedAreaChartProps> = ({
  data,
  width = 500,
  height = 160,
  formatValue = (n) => String(Math.round(n)),
  formatDate = (d) => {
    const date = new Date(d);
    return `${date.getUTCMonth() + 1}/${String(date.getUTCFullYear()).slice(2)}`;
  },
}) => {
  if (data.length === 0) return null;

  const marginLeft = 55;
  const marginRight = 10;
  const marginTop = 10;
  const marginBottom = 22;
  const chartW = width - marginLeft - marginRight;
  const chartH = height - marginTop - marginBottom;

  // Get all unique series keys from the first data point
  const seriesKeys = data[0].values.map((v) => v.key);
  const seriesLabels = new Map(data[0].values.map((v) => [v.key, v.label]));

  // Find max total for Y scale
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  // Round up to a nice number
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxTotal)));
  const yMax = Math.ceil(maxTotal / magnitude) * magnitude || 1;

  // Scale functions
  const xScale = (i: number) => marginLeft + (data.length > 1 ? (i / (data.length - 1)) * chartW : chartW / 2);
  const yScale = (v: number) => marginTop + chartH - (v / yMax) * chartH;

  // Build stacked paths — bottom to top
  const paths: { key: string; d: string; color: string }[] = [];

  for (let si = 0; si < seriesKeys.length; si++) {
    const key = seriesKeys[si];
    const color = CHART_COLORS[si % CHART_COLORS.length];

    // Top edge: cumulative sum up to and including this series
    const topPoints = data.map((dp, i) => {
      const cumulative = dp.values
        .slice(0, si + 1)
        .reduce((sum, v) => sum + v.value, 0);
      return `${xScale(i)},${yScale(cumulative)}`;
    });

    // Bottom edge: cumulative sum up to the previous series (or zero for first)
    const bottomPoints = data
      .map((dp, i) => {
        const cumulative =
          si === 0
            ? 0
            : dp.values.slice(0, si).reduce((sum, v) => sum + v.value, 0);
        return `${xScale(i)},${yScale(cumulative)}`;
      })
      .reverse();

    const d = `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
    paths.push({ key, d, color });
  }

  // Y-axis ticks (4-5 ticks)
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => (yMax / tickCount) * i);

  // Compact value formatter for axis labels
  const compactValue = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(Math.round(n));
  };

  // X-axis labels — show subset if too many
  const maxXLabels = 12;
  const xStep = Math.max(1, Math.ceil(data.length / maxXLabels));

  return (
    <View style={styles.container}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Chart background */}
        <Rect x={marginLeft} y={marginTop} width={chartW} height={chartH} fill="#fafbfc" />

        {/* Grid lines */}
        <G>
          {yTicks.map((tick, i) => (
            <Line
              key={i}
              x1={marginLeft}
              y1={yScale(tick)}
              x2={marginLeft + chartW}
              y2={yScale(tick)}
              stroke="#e2e8f0"
              strokeWidth={0.5}
            />
          ))}
        </G>

        {/* Stacked areas — render bottom series first (it gets painted first, then overlaid) */}
        <G>
          {paths.map((p) => (
            <Path key={p.key} d={p.d} fill={p.color} opacity={0.7} />
          ))}
        </G>

        {/* Axes */}
        <Line
          x1={marginLeft}
          y1={marginTop}
          x2={marginLeft}
          y2={marginTop + chartH}
          stroke="#94a3b8"
          strokeWidth={0.5}
        />
        <Line
          x1={marginLeft}
          y1={marginTop + chartH}
          x2={marginLeft + chartW}
          y2={marginTop + chartH}
          stroke="#94a3b8"
          strokeWidth={0.5}
        />
      </Svg>

      {/* Y-axis labels — rendered as layout Text for proper font support */}
      <View style={{ position: 'absolute', top: 0, left: 0 }}>
        {yTicks.map((tick, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: yScale(tick) - 5,
              left: 2,
              width: marginLeft - 6,
            }}
          >
            <Text style={{ fontSize: 7, color: '#94a3b8', textAlign: 'right' }}>
              {compactValue(tick)}
            </Text>
          </View>
        ))}
      </View>

      {/* X-axis labels */}
      <View style={{ position: 'absolute', top: height - marginBottom + 4, left: 0, flexDirection: 'row' }}>
        {data.map((dp, i) => {
          if (i % xStep !== 0) return null;
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: xScale(i) - 14,
                width: 28,
              }}
            >
              <Text style={{ fontSize: 7, color: '#94a3b8', textAlign: 'center' }}>
                {formatDate(dp.date)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {seriesKeys.map((key, i) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
            <Text style={styles.legendText}>{seriesLabels.get(key) ?? key}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};
