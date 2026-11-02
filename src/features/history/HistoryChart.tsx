import { useEffect, useRef, useState } from 'react';
import { init, use, type ComposeOption } from 'echarts/core';
import { LineChart, type LineSeriesOption } from 'echarts/charts';
import { GridComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Money, PriceObservation } from '../../shared/contracts';
import { historyChartPoints } from './history';

use([LineChart, GridComponent, TooltipComponent, SVGRenderer]);
type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption | TooltipComponentOption>;

export default function HistoryChart({ observations, currency }: { observations: PriceObservation[]; currency: Money['currency'] }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const chart = init(container.current, undefined, { renderer: 'svg' });
    try {
      const option: ChartOption = {
        animation: false, useUTC: true, textStyle: { fontFamily: 'IBM Plex Sans', fontSize: 11 },
        grid: { left: 70, right: 16, top: 20, bottom: 38 },
        xAxis: { type: 'time', axisLabel: { hideOverlap: true, color: '#526065' } },
        yAxis: { type: 'value', scale: true, axisLabel: { color: '#526065' }, splitLine: { lineStyle: { color: '#dce3e3' } } },
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        series: [{ name: currency, type: 'line', smooth: false, connectNulls: false,
          showSymbol: observations.length <= 500, symbolSize: 7, itemStyle: { color: '#12675f' },
          lineStyle: { color: '#12675f', width: 2 }, data: historyChartPoints(observations, currency) }],
      };
      chart.setOption(option);
    } catch { setFailed(true); }
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [observations, currency]);
  return <figure className="history-chart"><figcaption>Precios observados &middot; {currency}</figcaption>{failed ? <p role="status">Gr&aacute;fico no disponible. Tabla conservada.</p> : null}<div ref={container} role="img" aria-label={`Precios observados en ${currency}; los huecos no se conectan. Datos exactos en la tabla.`} /></figure>;
}