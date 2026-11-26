/* The reference stylesheets are deliberately loaded only with the editorial workspace. */
/* eslint-disable @next/next/no-css-tags */
"use client";

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {blogStudioMarkup} from './blog-studio-markup';
import SocialHeroConnection from './socialhero-connection';
import BlogTaxonomySettings from './blog-taxonomy-settings';

export default function BlogWorkspace(){
  const container=useRef<HTMLDivElement>(null);
  const[socialHeroMount,setSocialHeroMount]=useState<Element|null>(null);
  const[taxonomyMount,setTaxonomyMount]=useState<Element|null>(null);
  useEffect(()=>{
    let dispose:(()=>void)|undefined,cancelled=false;
    const social=container.current?.querySelector('#studio-socialhero-mount')||null;
    setSocialHeroMount(social);
    const taxonomy=document.createElement('div');taxonomy.id='studio-taxonomy-mount';
    social?.after(taxonomy);setTaxonomyMount(taxonomy);
    void import('./blog-editor-runtime').then(({mountBlogStudio})=>{
      if(!cancelled&&container.current)dispose=mountBlogStudio(container.current);
    });
    return()=>{cancelled=true;dispose?.();taxonomy.remove();};
  },[]);
  return <><link rel="stylesheet" href="/marketing.css"/><link rel="stylesheet" href="/blog-studio.css"/><div className="studio-body" ref={container} dangerouslySetInnerHTML={{__html:blogStudioMarkup}}/>{socialHeroMount&&createPortal(<SocialHeroConnection/>,socialHeroMount)}{taxonomyMount&&createPortal(<BlogTaxonomySettings/>,taxonomyMount)}</>;
}
