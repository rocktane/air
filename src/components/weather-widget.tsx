import { useQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '../../convex/_generated/api'

// Today's-weather widget shown at the top of the digest. Configured in settings
// (toggle + free-text city list). Data comes from Open-Meteo — keyless and
// CORS-enabled, so it's fetched directly from the browser.

type Weather = {
  name: string
  temp: number
  high: number
  low: number
  code: number
}

export function WeatherWidget() {
  const { data: settings } = useQuery(convexQuery(api.settings.get, {}))
  const enabled = settings?.weatherEnabled ?? false
  const cities = settings?.weatherCities ?? []
  if (!enabled || cities.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {cities.map((city) => (
        <CityWeather key={city} city={city} />
      ))}
    </div>
  )
}

function CityWeather({ city }: { city: string }) {
  const { data, isPending, isError } = useQuery<Weather>({
    queryKey: ['weather', city],
    queryFn: () => fetchWeather(city),
    staleTime: 1000 * 60 * 30, // 30 min
    retry: 1,
  })

  if (isPending) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="capitalize">{city}</span>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed bg-card px-3 py-2 text-sm text-muted-foreground">
        <span aria-hidden>⚠️</span>
        <span className="capitalize">{city} — introuvable</span>
      </div>
    )
  }

  const { emoji, label } = describe(data.code)
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2"
      title={`${data.name} — ${label}`}
    >
      <span className="text-2xl leading-none" aria-hidden>
        {emoji}
      </span>
      <div className="leading-tight">
        <div className="text-sm font-medium">{data.name}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
      <div className="ml-1 text-right leading-tight">
        <div className="text-sm font-semibold">{data.temp}°</div>
        <div className="text-xs text-muted-foreground">
          {data.high}° / {data.low}°
        </div>
      </div>
    </div>
  )
}

async function fetchWeather(city: string): Promise<Weather> {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      city,
    )}&count=1&language=fr&format=json`,
  )
  if (!geoRes.ok) throw new Error('Géocodage indisponible')
  const geo = await geoRes.json()
  const loc = geo?.results?.[0]
  if (!loc) throw new Error('Ville introuvable')

  const fcRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`,
  )
  if (!fcRes.ok) throw new Error('Prévisions indisponibles')
  const fc = await fcRes.json()

  return {
    name: loc.name,
    temp: Math.round(fc.current.temperature_2m),
    code: fc.current.weather_code,
    high: Math.round(fc.daily.temperature_2m_max[0]),
    low: Math.round(fc.daily.temperature_2m_min[0]),
  }
}

// WMO weather-interpretation codes → emoji + French label.
function describe(code: number): { emoji: string; label: string } {
  switch (code) {
    case 0:
      return { emoji: '☀️', label: 'Ciel dégagé' }
    case 1:
      return { emoji: '🌤️', label: 'Plutôt dégagé' }
    case 2:
      return { emoji: '⛅', label: 'Partiellement nuageux' }
    case 3:
      return { emoji: '☁️', label: 'Couvert' }
    case 45:
    case 48:
      return { emoji: '🌫️', label: 'Brouillard' }
    case 51:
    case 53:
    case 55:
      return { emoji: '🌦️', label: 'Bruine' }
    case 56:
    case 57:
      return { emoji: '🌧️', label: 'Bruine verglaçante' }
    case 61:
    case 63:
    case 65:
      return { emoji: '🌧️', label: 'Pluie' }
    case 66:
    case 67:
      return { emoji: '🌧️', label: 'Pluie verglaçante' }
    case 71:
    case 73:
    case 75:
    case 77:
      return { emoji: '🌨️', label: 'Neige' }
    case 80:
    case 81:
    case 82:
      return { emoji: '🌦️', label: 'Averses' }
    case 85:
    case 86:
      return { emoji: '🌨️', label: 'Averses de neige' }
    case 95:
      return { emoji: '⛈️', label: 'Orage' }
    case 96:
    case 99:
      return { emoji: '⛈️', label: 'Orage, grêle' }
    default:
      return { emoji: '🌡️', label: '—' }
  }
}
