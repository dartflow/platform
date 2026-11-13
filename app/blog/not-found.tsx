import {appConfig} from '@/lib/config';
import {BlogPublicPage} from '@/components/blog-public';
export default function BlogNotFound(){return <BlogPublicPage origin={appConfig().origin} body={'<main id="inhoud" class="wrap blog-home blog-not-found" tabindex="-1"><div class="blog-intro"><h1>Artikel niet gevonden</h1><p>Bekijk de beschikbare artikelen op de DartFlow-blog.</p><a class="button button-primary" href="/blog">Naar de blog</a></div></main>'}/>;}
