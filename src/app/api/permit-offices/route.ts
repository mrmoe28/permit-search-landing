import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { georgiaPermitOffices } from '@/lib/georgia-permit-data'

// Search for permit offices by location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const latitude = searchParams.get('lat')
    const longitude = searchParams.get('lng')
    const city = searchParams.get('city')
    const county = searchParams.get('county')
    const state = searchParams.get('state')

    let query = supabase
      .from('permit_offices')
      .select('*')
      .eq('active', true)

    // Filter by Georgia first
    if (state) {
      query = query.eq('state', state.toUpperCase())
    } else {
      query = query.eq('state', 'GA') // Default to Georgia
    }

    // Search by city if provided
    if (city) {
      query = query.ilike('city', `%${city}%`)
    }

    // Search by county if provided
    if (county) {
      query = query.ilike('county', `%${county}%`)
    }

    const { data: offices, error } = await query
      .order('jurisdiction_type', { ascending: true })
      .order('city', { ascending: true })
      .limit(10)

    if (error) {
      console.error('Supabase error:', error)
      // Fallback to static data if database fails
      return getFallbackGeorgiaOffices(city, county)
    }

    // If no results from database, check fallback data
    if (!offices || offices.length === 0) {
      return getFallbackGeorgiaOffices(city, county)
    }

    // Calculate distances if coordinates provided
    let enrichedOffices = offices
    if (latitude && longitude) {
      enrichedOffices = offices.map(office => ({
        ...office,
        distance: office.latitude && office.longitude 
          ? calculateDistance(
              parseFloat(latitude), 
              parseFloat(longitude),
              office.latitude,
              office.longitude
            )
          : null
      })).sort((a, b) => (a.distance || 999) - (b.distance || 999))
    }

    return NextResponse.json({
      success: true,
      offices: enrichedOffices,
      count: enrichedOffices.length,
      source: 'database'
    })

  } catch (error) {
    console.error('Permit offices search error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Initialize database with Georgia permit offices
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json()
    
    if (action !== 'seed_georgia_data') {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      )
    }

    // Insert Georgia permit offices
    const { data, error } = await supabase
      .from('permit_offices')
      .upsert(georgiaPermitOffices, { 
        onConflict: 'city,county,department_name',
        ignoreDuplicates: false 
      })
      .select()

    if (error) {
      console.error('Database seed error:', error)
      return NextResponse.json(
        { error: 'Failed to seed database', details: error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Georgia permit offices added to database',
      count: data?.length || 0,
      offices: data
    })

  } catch (error) {
    console.error('Database seed error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Fallback to static Georgia data
function getFallbackGeorgiaOffices(city?: string | null, county?: string | null) {
  let offices = georgiaPermitOffices

  if (city) {
    offices = offices.filter(office => 
      office.city.toLowerCase().includes(city.toLowerCase())
    )
  }

  if (county) {
    offices = offices.filter(office => 
      office.county.toLowerCase().includes(county.toLowerCase())
    )
  }

  return NextResponse.json({
    success: true,
    offices: offices,
    count: offices.length,
    source: 'fallback'
  })
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c // Distance in miles
}