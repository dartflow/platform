import type {Metadata} from 'next';
import {redirect,notFound} from 'next/navigation';
import {actorId} from '@/lib/auth';
import {requireBlogAdmin} from '@/lib/blog-store';
import {BlogError} from '@/lib/blog-types';
import BlogWorkspace from '@/components/blog-workspace';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Blogbeheer | DartFlow',robots:{index:false,follow:false,noarchive:true}};
export default async function BlogManagement(){
  const actor=await actorId();if(!actor)redirect('/inloggen?next=%2Fblog%2Fbeheer');
  try{await requireBlogAdmin(actor);}catch(error){if(error instanceof BlogError&&error.status===403)notFound();throw error;}
  return <BlogWorkspace/>;
}
