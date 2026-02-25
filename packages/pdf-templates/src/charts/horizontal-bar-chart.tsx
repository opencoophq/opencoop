import React from 'react';
import { Svg, Rect, Line, G, View, Text, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    width: 120,
    fontSize: 9,
    color: '#555555',
  },
  barContainer: {
    flex: 1,
  },
  valueText: {
    width: 80,
    fontSize: 9,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
  },
});

export interface HorizontalBarChartProps {
  data: { label: string; value: number; color: string }[];
  width?: number;
  barHeight?: number;
  formatValue?: (n: number) => string;
}

export const HorizontalBarChart: React.FC<HorizontalBarChartProps> = ({
  data,
  width = 300,
  barHeight = 16,
  formatValue = String,
}) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={styles.container}>
      {data.map((item, i) => {
        const barWidth = Math.max((item.value / maxValue) * width, 2);
        return (
          <View key={i} style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            <View style={styles.barContainer}>
              <Svg width={width} height={barHeight} viewBox={`0 0 ${width} ${barHeight}`}>
                {/* Background track */}
                <Rect x={0} y={0} width={width} height={barHeight} fill="#f0f4ff" rx={3} />
                {/* Value bar */}
                <Rect x={0} y={0} width={barWidth} height={barHeight} fill={item.color} rx={3} />
                {/* Reference line at max */}
                <Line
                  x1={width}
                  y1={0}
                  x2={width}
                  y2={barHeight}
                  stroke="#e2e8f0"
                  strokeWidth={0.5}
                />
              </Svg>
            </View>
            <Text style={styles.valueText}>{formatValue(item.value)}</Text>
          </View>
        );
      })}
    </View>
  );
};
