import {NextResponse} from 'next/server';import {db,ensureSchema} from '../../../lib/db';
export async function GET(){try{await ensureSchema();await db.query('SELECT 1');return NextResponse.json({status:'ok',database:'connected'})}catch{return NextResponse.json({status:'error',database:'unavailable'},{status:503})}}
