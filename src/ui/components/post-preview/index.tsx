import React, { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DirPopover } from '../../../uikit/dir-popover';
import {
    COHOST_RENDERER_VERSION,
    loadRenderer,
    RenderFn,
    RenderConfig,
    RenderResult,
} from './cohost-renderer';
import { RenderContext } from '../../render-context';
import { CohostPlusIcon, CohostRegularIcon, PreviewRenderIcon } from '../icons';
import './index.scss';
import {
    COHOST_APPROX_MAX_PAYLOAD_SIZE,
    ErrorMessage,
    ERRORS,
    getExportWarnings,
    handleAsyncErrors,
    renderMarkdown,
} from './basic-renderer';
import { Button } from '../../../uikit/button';
import { createPortal } from 'react-dom';
import { DarkThemeButton } from './dark-theme-button';

const RESET_ON_RENDER = true;

function BasicRenderer({
    html,
    error,
    errorPortal,
}: {
    html: string;
    error: React.ReactNode | null;
    errorPortal: HTMLDivElement | null;
}) {
    return (
        <>
            <div
                className="inner-prose prose p-prose co-prose basic-renderer"
                role="article"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {error && errorPortal
                ? createPortal(<div className="inner-cohost-error">{error}</div>, errorPortal)
                : null}
        </>
    );
}

function CohostRenderer({
    renderId,
    rendered,
    readMore,
    onReadMoreChange,
}: {
    renderId: string;
    rendered: RenderResult;
    readMore: boolean;
    onReadMoreChange: (r: boolean) => void;
}) {
    return (
        <Fragment>
            <div
                className="inner-prose prose p-prose co-prose cohost-renderer"
                role="article"
                key={RESET_ON_RENDER && renderId}
            >
                {rendered.initial}
                {readMore ? rendered.expanded : null}
            </div>
            {rendered.expandedLength ? (
                <a className="prose-read-more" onClick={() => onReadMoreChange(!readMore)}>
                    {readMore ? 'read less' : 'read more'}
                </a>
            ) : null}
        </Fragment>
    );
}

function useCohostRenderer(): RenderFn | null {
    const rendererPromise = useMemo(() => loadRenderer(), undefined);
    const [renderer, setRenderer] = useState<{ current: RenderFn | null }>({ current: null });

    useEffect(() => {
        rendererPromise.then((renderer) => {
            setRenderer({ current: renderer });
        });
    }, [rendererPromise]);

    return renderer.current;
}

function getCohostErrorMessage(rendered: any): React.ReactNode | null {
    if (rendered?.props?.className === 'not-prose' && rendered?.props?.children?.type === 'p') {
        return rendered;
    }
    return null;
}

function MarkdownRenderer({
    renderId,
    cohostRenderer,
    config,
    markdown,
    fallbackHtml,
    readMore,
    onReadMoreChange,
    errorPortal,
    onRender,
}: {
    renderId: string;
    cohostRenderer: RenderFn | null;
    config: RenderConfig;
    markdown: string;
    fallbackHtml: string;
    readMore: boolean;
    onReadMoreChange: (b: boolean) => void;
    errorPortal: HTMLDivElement | null;
    onRender: () => void;
}) {
    const [rendered, setRendered] = useState<RenderResult | null>(null);
    const [error, setError] = useState<React.ReactNode | null>(null);

    const [triggerOnRender, setTriggerOnRender] = useState(0);

    useEffect(() => {
        if (cohostRenderer) {
            const thisRenderId = renderId;

            cohostRenderer(markdown, config)
                .then((result) => {
                    if (renderId !== thisRenderId) return;

                    const error =
                        getCohostErrorMessage(result.initial) ||
                        getCohostErrorMessage(result.expanded);
                    setError(error);

                    if (error) {
                        setRendered(null);
                    } else {
                        setRendered(result);
                    }
                })
                .catch((error) => {
                    if (renderId !== thisRenderId) return;
                    // oh well
                    console.error('cohost renderer error', error);
                    setRendered(null);
                    setError(<div className="cohost-message-box">{error.toString()}</div>);
                })
                .finally(() => {
                    setTriggerOnRender(triggerOnRender + 1);
                });
        } else {
            setTriggerOnRender(triggerOnRender + 1);
        }
    }, [cohostRenderer, config, markdown]);

    useEffect(() => {
        onRender();
    }, [triggerOnRender]);

    if (cohostRenderer && rendered) {
        return (
            <CohostRenderer
                renderId={renderId}
                rendered={rendered}
                readMore={readMore}
                onReadMoreChange={onReadMoreChange}
            />
        );
    }

    return <BasicRenderer html={fallbackHtml} error={error} errorPortal={errorPortal} />;
}

export interface PreviewConfig {
    render: RenderConfig;
    cohostRenderer: boolean;
    prefersReducedMotion: boolean;
    darkTheme: boolean;
    siteDarkTheme: boolean;
}

const DEFAULT_RENDER_CONFIG: RenderConfig = {
    disableEmbeds: false,
    externalLinksInNewTab: true,
    hasCohostPlus: true,
};

export const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
    render: DEFAULT_RENDER_CONFIG,

    cohostRenderer: true,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    darkTheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
    siteDarkTheme: window.matchMedia('(prefers-color-scheme: dark)').matches,
};

export function PostPreview({
    renderId,
    markdown,
    error,
    stale,
    config,
    onConfigChange,
    readMore,
    onReadMoreChange,
    errorPortal,
}: PostPreview.Props) {
    let html = '';
    const renderErrors: ErrorMessage[] = [];
    try {
        html = renderMarkdown(markdown, (id, props) => renderErrors.push({ id, props }));
    } catch (err) {
        error = err as Error;
    }

    const cohostRenderer = useCohostRenderer();

    const proseContainer = useRef<HTMLDivElement>(null);
    const errorBtn = useRef<HTMLButtonElement>(null);
    const [errorsOpen, setErrorsOpen] = useState(false);
    const [asyncErrors, setAsyncErrors] = useState<ErrorMessage[]>([]);

    const newAsyncErrors = asyncErrors.slice();
    const pushAsyncError = (id: keyof typeof ERRORS, props: any) => {
        // we mutate to fix janky update coalescion issues
        newAsyncErrors.push({ id, props });
        setAsyncErrors(newAsyncErrors);
    };

    const pushAsyncErrorRef = useRef(pushAsyncError);
    pushAsyncErrorRef.current = pushAsyncError;
    const asyncErrorRenderId = useRef(0);

    const onRender = () => {
        newAsyncErrors.splice(0);
        setAsyncErrors(newAsyncErrors);
        const thisRenderId = ++asyncErrorRenderId.current;

        if (proseContainer.current) {
            handleAsyncErrors(proseContainer.current, (id, props) => {
                if (thisRenderId !== asyncErrorRenderId.current) return;
                pushAsyncErrorRef.current(id, props);
            });
        }
    };

    const errorCount = renderErrors.length + asyncErrors.length;

    return (
        <div
            className={
                'post-preview' +
                (stale ? ' is-stale' : '') +
                (config.darkTheme ? ' dark-theme' : '') +
                (config.siteDarkTheme ? ' is-site-dark-theme' : '')
            }
        >
            <div className="prose-container ao3-main">
                <div id="outer" className="wrapper inner-prose prose p-prose co-prose cohost-renderer">
                    <ul id="skiplinks"><li><a href="#main">Main Content</a></li></ul>
                    <header id="header" className="region">

                        <h1 className="heading">
                            <a href="/"><span>Archive of Our Own</span></a>
                        </h1>

                        <nav id="greeting" aria-label="User">
                            <ul className="user navigation actions">
                                <li className="dropdown">
                                    <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">Hi, User!</a>
                                    <ul className="menu dropdown-menu">
                                        <li><a>My Dashboard</a></li>
                                        <li><a>My Subscriptions</a></li>
                                        <li><a>My Works</a></li>
                                        <li><a>My Bookmarks</a></li>
                                        <li><a>My History</a></li>
                                        <li><a>My Preferences</a></li>
                                    </ul>
                                </li>
                                <li className="dropdown" aria-haspopup="true">
                                    <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">Post</a>
                                    <ul className="menu dropdown-menu">
                                        <li><a>New Work</a></li>
                                        <li><a>Import Work</a></li>
                                    </ul>
                                </li>
                                <li><a>Log Out</a></li>
                            </ul>

                            <p className="icon"><a><img alt="" className="icon" /></a></p>
                        </nav>


                        <nav aria-label="Site">
                            <ul className="primary navigation actions">
                                <li className="dropdown" aria-haspopup="true">
                                    <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">Fandoms</a>
                                    <ul className="menu dropdown-menu">
                                        <li><a>All Fandoms</a></li>
                                        <li id="medium_5"><a>Anime &amp; Manga</a></li>
                                        <li id="medium_3"><a>Books &amp; Literature</a></li>
                                        <li id="medium_4"><a>Cartoons &amp; Comics &amp; Graphic Novels</a></li>
                                        <li id="medium_7"><a>Celebrities &amp; Real People</a></li>
                                        <li id="medium_2"><a>Movies</a></li>
                                        <li id="medium_6"><a>Music &amp; Bands</a></li>
                                        <li id="medium_8"><a>Other Media</a></li>
                                        <li id="medium_30198"><a>Theater</a></li>
                                        <li id="medium_1"><a>TV Shows</a></li>
                                        <li id="medium_476"><a>Video Games</a></li>
                                        <li id="medium_9971"><a>Uncategorized Fandoms</a></li>
                                    </ul>

                                </li>
                                <li className="dropdown" aria-haspopup="true">
                                    <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">Browse</a>
                                    <ul className="menu dropdown-menu">
                                        <li><a>Works</a></li>
                                        <li><a>Bookmarks</a></li>
                                        <li><a>Tags</a></li>
                                        <li><a>Collections</a></li>
                                    </ul>

                                </li>
                                <li className="dropdown" aria-haspopup="true">
                                    <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">Search</a>
                                    <ul className="menu dropdown-menu">
                                        <li><a>Works</a></li>
                                        <li><a>Bookmarks</a></li>
                                        <li><a>Tags</a></li>
                                        <li><a>People</a></li>
                                    </ul>

                                </li>
                                <li className="dropdown" aria-haspopup="true">
                                    <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">About</a>
                                    <ul className="menu dropdown-menu">
                                        <li><a>About Us</a></li>
                                        <li><a>News</a></li>
                                        <li><a>FAQ</a></li>
                                        <li><a>Wrangling Guidelines</a></li>
                                        <li><a href="https://archiveofourown.org/donate" target="_blank">Donate or Volunteer</a></li>
                                    </ul>

                                </li>
                                <li className="search"><form className="search" id="search">
                                    <fieldset>
                                        <p>
                                            <label className="landmark" htmlFor="site_search">Work Search</label>
                                            <input disabled className="text" id="site_search" aria-describedby="site_search_tooltip" type="text" name="work_search[query]"></input>
                                            <span className="tip" role="tooltip" id="site_search_tooltip">tip: arthur merlin words&gt;1000 sort:hits</span>
                                            <span className="submit actions"><button disabled className="button">Search</button></span>
                                        </p>
                                    </fieldset>
                                </form></li>
                            </ul>
                        </nav>



                        <div className="clear"></div>

                    </header>

                    <div id="inner" className="wrapper">
                        <div id="main" className="chapters-show region" role="main">
                            <div className="flash"></div>
                            <div className="work">
                                <p className="landmark"><a>&nbsp;</a></p>
                                <h3 className="landmark heading">Actions</h3>
                                <ul className="work navigation actions">

                                    <li className="add"><a>Add Chapter</a></li>
                                    <li className="edit"><a>Edit</a></li>
                                    <li className="edit tag"><a>Edit Tags</a></li>


                                    <li className="chapter entire"><a>Entire Work</a></li>

                                    <li className="chapter previous"><a>← Previous Chapter</a></li>

                                    <li className="chapter next"><a>Next Chapter →</a></li>

                                    <li className="chapter"><noscript><a>Chapter Index</a></noscript><button className="collapsed">Chapter Index</button>
                                        <ul id="chapter_index" className="expandable secondary hidden">
                                            <li>
                                                <form accept-charset="UTF-8" method="get">
                                                    <p>
                                                        <select name="selected_id" id="selected_id"><option value="1">Chapter 1</option>
                                                            <option selected value="2">Chapter 2</option>
                                                            <option value="3">Chapter 3</option></select>
                                                        <span className="submit actions"><input type="submit" name="commit" value="Go" /></span>
                                                    </p>
                                                </form>
                                            </li>
                                            <li><a>Full-Page Index</a></li>
                                        </ul>
                                    </li>


                                    <li className="bookmark">
                                        <a className="bookmark_form_placement_open">Bookmark</a>
                                    </li>


                                    <li className="comments" id="show_comments_link_top">
                                        <a>Comments</a>
                                    </li>


                                    <li className="style">
                                        <a>Hide Creator's Style</a>
                                    </li>

                                    <li className="share">
                                        <a className="modal modal-attached" title="Share Work">Share</a>
                                    </li>

                                    <li className="subscribe">
                                        <form className="ajax-create-destroy" accept-charset="UTF-8" method="post">
                                            <input type="submit" disabled name="commit" value="Subscribe" />
                                        </form>
                                    </li>

                                    <li className="share"><button className="collapsed">Download</button>
                                    </li>
                                </ul>
                                <div>
                                    <details style={{ display: 'table', margin: '0 auto' }}>
                                        <summary className="action">Fic Details</summary>
                                        <div className="wrapper">

                                            <dl className="work meta group">
                                                <dt className="rating tags">

                                                    Rating:
                                                </dt>

                                                <dd className="rating tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">Explicit</a></li>
                                                    </ul>
                                                </dd>
                                                <dt className="warning tags">

                                                    <a>Archive Warning</a>:
                                                </dt>

                                                <dd className="warning tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">Creator Chose Not To Use Archive Warnings</a></li>
                                                    </ul>
                                                </dd>
                                                <dt className="category tags">

                                                    Categories:
                                                </dt>

                                                <dd className="category tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">F/F</a></li>
                                                        <li><a className="tag">Multi</a></li>
                                                        <li><a className="tag">Other</a></li>
                                                    </ul>
                                                </dd>
                                                <dt className="fandom tags">

                                                    Fandom:
                                                </dt>

                                                <dd className="fandom tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">Generic Fandom</a></li>
                                                    </ul>
                                                </dd>
                                                <dt className="relationship tags">

                                                    Relationships:
                                                </dt>

                                                <dd className="relationship tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">Character A/Character B</a></li>
                                                    </ul>
                                                </dd>
                                                <dt className="character tags">

                                                    Characters:
                                                </dt>

                                                <dd className="character tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">Character A</a></li>
                                                        <li><a className="tag">Character B</a></li>
                                                    </ul>
                                                </dd>
                                                <dt className="freeform tags">

                                                    Additional Tags:
                                                </dt>

                                                <dd className="freeform tags">
                                                    <ul className="commas">
                                                        <li><a className="tag">Slice of Life</a></li>
                                                        <li><a className="tag">Alternate Universe</a></li>
                                                    </ul>
                                                </dd>

                                                <dt className="language">
                                                    Language:
                                                </dt>
                                                <dd className="language" lang="en">
                                                    English
                                                </dd>



                                                <dt className="stats">Stats:</dt>
                                                <dd className="stats">
                                                    <dl className="stats">
                                                        <dt className="published">Published:</dt>
                                                        <dd className="published">2023-10-09</dd>
                                                        <dt className="status">Updated:</dt>
                                                        <dd className="status">2026-07-18</dd>
                                                        <dt className="words">Words:</dt>
                                                        <dd className="words">128,679</dd>
                                                        <dt className="chapters">Chapters:</dt>
                                                        <dd className="chapters">97/?</dd>
                                                        <dt className="comments">Comments:</dt>
                                                        <dd className="comments">35</dd>
                                                        <dt className="kudos">Kudos:</dt>
                                                        <dd className="kudos">312</dd>
                                                        <dt className="bookmarks">Bookmarks:</dt>
                                                        <dd className="bookmarks">87</dd>
                                                        <dt className="hits">Hits:</dt>
                                                        <dd className="hits">1,213</dd>
                                                    </dl>
                                                </dd>
                                            </dl>
                                        </div>
                                    </details>
                                </div>


                                <h3 className="landmark heading">Work Header</h3>




                                <div id="work-skin" className="wrapper">
                                    <div id="workskin">
                                        <div className="preface group">
                                            <h2 className="title heading">
                                                Fic Title
                                            </h2>
                                            <h3 className="byline heading">
                                                <a rel="author">Author Name</a>
                                            </h3>

                                        </div>

                                        <div id="chapters">
                                            <div className="chapter" id="chapter-2">
                                                <h3 className="landmark heading">Chapter Management</h3>
                                                <div className='post-header' style={{ float: 'right', clear: 'left' }}>
                                                    <span className="i-errors-container">
                                                        <button
                                                            ref={errorBtn}
                                                            className={'i-errors-button action' + (errorCount ? ' has-errors' : '')}
                                                            disabled={!errorCount}
                                                            onClick={() => setErrorsOpen(true)}
                                                            aria-label={errorCount === 1 ? '1 error' : `${errorCount} errors`}
                                                        >
                                                            <span className="i-errors-icon">!</span>
                                                            <span className="i-errors-count">{errorCount}</span>
                                                        </button>
                                                        <DirPopover
                                                            anchor={errorBtn.current}
                                                            open={errorsOpen}
                                                            onClose={() => setErrorsOpen(false)}
                                                        >
                                                            <ErrorList errors={renderErrors.concat(asyncErrors)} />
                                                        </DirPopover>
                                                    </span>
                                                </div>
                                                <button className='action' style={{ float: 'right', marginRight: '8px' }}>Edit Chapter</button>



                                                <div className="chapter preface group">
                                                    <h3 className="title">
                                                        <a>Chapter 1</a>: Chapter Title
                                                    </h3>
                                                </div>

                                                <div className="userstuff module" role="article">
                                                    <h3 className="landmark heading" id="work">Chapter Text</h3>
                                                    <div dangerouslySetInnerHTML={{ __html: html }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div id="feedback" className="feedback">

                                <h3 className="landmark heading">Actions</h3>
                                <div className="post-footer-simulate" style={{ float: 'right' }}>
                                    <PostSize size={markdown.length} />
                                    <CopyToClipboard disabled={!!error} data={markdown} label="Copy to clipboard" />
                                </div>


                                <div id="kudos_message"></div>


                                <h3 className="landmark heading">Kudos</h3>
                                <div id="kudos">
                                    <p className="kudos">
                                        <a href="https://archiveofourown.org/users/vaynegarden">vaynegarden</a> and 39 guests
                                        left kudos on this work!
                                    </p>
                                </div>

                                <h3 className="landmark heading"><a id="comments">Comments</a></h3>
                                <div id="add_comment_placeholder" title="top level comment">
                                    <div id="add_comment">
                                        <div className="post comment">
                                            <form className="new_comment" accept-charset="UTF-8" method="post">
                                                <input type="hidden" name="authenticity_token" />
                                                <fieldset>
                                                    <legend>Post Comment</legend>

                                                    <h4 className="heading">Comment as <select style={{
                                                        pointerEvents: "none"
                                                    }} title="Choose Name" name="comment[pseud_id]">
                                                        <option selected>User</option></select>
                                                    </h4>

                                                    <p className="footnote">Plain text with limited HTML  <a className="help symbol question modal modal-attached" aria-label="Html help"><span className="symbol question"><span>?</span></span></a></p>

                                                    <p>
                                                        <label className="landmark">Comment</label>
                                                        <textarea style={{
                                                            pointerEvents: "none"
                                                        }} className="comment_form observe_textlength" title="Enter Comment" name="comment[comment_content]"></textarea><span role="alert" className=" LV_validation_message LV_valid"></span>
                                                        <input type="hidden" name="controller_name" value="chapters" />
                                                    </p>
                                                    <p className="character_counter"><span className="value" data-maxlength="10000">1000</span> characters left</p>
                                                    <p className="submit actions">
                                                        <input disabled type="submit" name="commit" value="Comment" data-disable-with="Please wait..." />
                                                    </p>
                                                </fieldset>
                                            </form></div>
                                        <div className="clear"></div>

                                    </div>
                                </div>
                                <div id="modal-bg" className="modal-closer"><div className="loading"></div></div><div id="modal-wrap" className="modal-closer"><div id="modal"><div className="content userstuff"></div><div className="footer"><span className="title"></span><a className="action modal-closer" href="#">Close</a></div></div></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {
                error ? (
                    <div className="prose-container p-prose-outer">
                        <div className="inner-prose prose p-prose co-prose is-error">
                            {error
                                .toString()
                                .split('\n')
                                .map((line, i) => (
                                    <div key={i}>{line}</div>
                                ))}
                        </div>
                    </div>
                ) : (
                    <div
                        className="prose-container p-prose-outer co-themed-box"
                        ref={proseContainer}
                        data-theme={config.darkTheme ? 'dark' : 'light'}
                        data-media-color-scheme={config.siteDarkTheme ? 'dark' : 'light'}
                        style={{ pointerEvents: 'none' }}
                    >
                        <DynamicStyles config={config} />
                        <MarkdownRenderer
                            renderId={renderId}
                            cohostRenderer={config.cohostRenderer ? cohostRenderer : null}
                            config={config.render}
                            markdown={markdown}
                            fallbackHtml={html}
                            readMore={readMore}
                            onReadMoreChange={onReadMoreChange}
                            errorPortal={errorPortal}
                            onRender={onRender}
                        />
                    </div>
                )
            }
            <hr />

        </div >
    );
}

namespace PostPreview {
    export interface Props {
        renderId: string;
        markdown: string;
        error?: Error | null;
        stale?: boolean;
        config: PreviewConfig;
        onConfigChange: (c: PreviewConfig) => void;
        readMore: boolean;
        onReadMoreChange: (b: boolean) => void;
        errorPortal: HTMLDivElement | null;
    }
}

function ErrorList({ errors }: { errors: ErrorMessage[] }) {
    const seenTypes = new Set<string>();

    return (
        <ul className="i-errors">
            {errors.map(({ id, props }, i) => {
                const Component = (ERRORS as any)[id];
                const isFirstOfType = !seenTypes.has(id.toString());
                seenTypes.add(id.toString());
                return (
                    <li className="i-error" key={'r' + i}>
                        <Component {...props} isFirstOfType={isFirstOfType} />
                    </li>
                );
            })}
        </ul>
    );
}

interface RenderConfigItem {
    short: [string | null, string] | null;
    label: string;
    description: string;
    inRender?: boolean;
    renderOnChange?: boolean;
    requiresCohostRenderer?: boolean;
}

const RENDER_CONFIG_ITEMS: { [k: string]: RenderConfigItem } = {
    cohostRenderer: {
        short: null,
        label: 'Cohost Renderer',
        description: `Uses the cohost markdown renderer (from ${COHOST_RENDERER_VERSION}). Turn this off to test with an approximate renderer that is less strict.`,
        requiresCohostRenderer: true,
    },
    prefersReducedMotion: {
        short: ['motion ✓', 'reduced motion'],
        label: 'Reduced Motion',
        description:
            'Disables the `spin` animation and enables the `pulse` animation. This simulates the effect of @media (prefers-reduced-motion: reduce) on cohost.',
        renderOnChange: true,
    },
    hasCohostPlus: {
        short: null,
        label: 'Cohost Plus!',
        description: 'Enables Cohost Plus! features (emoji). Use this if you have Cohost Plus!',
        inRender: true,
        requiresCohostRenderer: true,
    },
    siteDarkTheme: {
        short: null,
        label: 'Dark Site Theme',
        description:
            'Sets the site theme to the dark theme. Controlled by the OS theme on Cohost. Affects variables like `--color-text`.',
    },
    disableEmbeds: {
        short: [null, 'no embeds'],
        label: 'Disable Embeds',
        description:
            'Disables Iframely embeds in the post. This is a feature in Cohost settings. Though, quite frankly, it’s not very useful here.',
        inRender: true,
        requiresCohostRenderer: true,
    },
};

function RenderConfigEditor({
    hasCohostRenderer,
    config,
    onConfigChange,
}: {
    hasCohostRenderer: boolean;
    config: PreviewConfig;
    onConfigChange: (c: PreviewConfig) => void;
}) {
    const configButton = useRef<HTMLButtonElement>(null);
    const [configOpen, setConfigOpen] = useState(false);

    const items = [];

    if (!hasCohostRenderer || !config.cohostRenderer) {
        items.push(<PreviewRenderIcon key="preview" />);
    } else if (config.render.hasCohostPlus) {
        items.push(<CohostPlusIcon key="preview" />);
    } else {
        items.push(<CohostRegularIcon key="preview" />);
    }

    for (const k in RENDER_CONFIG_ITEMS) {
        const v = RENDER_CONFIG_ITEMS[k];

        if (!v.short) continue;
        if (v.requiresCohostRenderer && (!hasCohostRenderer || !config.cohostRenderer)) continue;
        const enabled = v.inRender
            ? config.render[k as unknown as keyof RenderConfig]
            : config[k as unknown as keyof PreviewConfig];
        const label = enabled ? v.short[1] : v.short[0];
        if (!label) continue;
        items.push(
            <div className="config-preview-item" key={k}>
                {label}
            </div>
        );
    }

    return (
        <div className="render-config">
            <button
                ref={configButton}
                className="i-config-button"
                onClick={() => setConfigOpen(true)}
            >
                <svg className="config-icon" viewBox="0 0 20 20">
                    <path
                        fill="currentcolor"
                        fillRule="evenodd"
                        d="M11 2a1 1 0 0 1 1 1v1.342A5.994 5.994 0 0 1 13.9 5.439l1.163-.671a1 1 0 0 1 1.366.366l1 1.732a1 1 0 0 1-.366 1.366l-1.162.672a6.034 6.034 0 0 1 0 2.192l1.162.672a1 1 0 0 1 .366 1.366l-1 1.732a1 1 0 0 1-1.366.366l-1.163-.671A5.994 5.994 0 0 1 12 15.658V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-1.342A5.994 5.994 0 0 1 6.1 14.561l-1.163.671a1 1 0 0 1-1.366-.366l-1-1.732a1 1 0 0 1 .366-1.366l1.162-.672a6.034 6.034 0 0 1 0-2.192l-1.162-.672a1 1 0 0 1-.366-1.366l1-1.732a1 1 0 0 1 1.366-.366l1.163.671A5.994 5.994 0 0 1 8 4.342V3a1 1 0 0 1 1-1h2Zm-1 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"
                    />
                </svg>
                {items}
            </button>
            <DirPopover
                anchor={configButton.current}
                anchorBias="left"
                open={configOpen}
                onClose={() => setConfigOpen(false)}
            >
                <RenderConfigPopover
                    hasCohostRenderer={hasCohostRenderer}
                    config={config}
                    onConfigChange={onConfigChange}
                />
            </DirPopover>
        </div>
    );
}

function RenderConfigPopover({
    hasCohostRenderer,
    config,
    onConfigChange,
}: {
    hasCohostRenderer: boolean;
    config: PreviewConfig;
    onConfigChange: (c: PreviewConfig) => void;
}) {
    const renderContext = useContext(RenderContext);

    return (
        <div className="i-config-contents">
            <div className="i-config-title">Post Preview Settings</div>
            {!hasCohostRenderer && (
                <div className="i-cohost-unavailable">
                    <div className="i-icon">
                        <PreviewRenderIcon />
                    </div>
                    <div>cohost renderer unavailable</div>
                </div>
            )}
            {Object.entries(RENDER_CONFIG_ITEMS).map(([k, v]) => {
                if (v.requiresCohostRenderer && !hasCohostRenderer) return null;
                if (k !== 'cohostRenderer' && v.requiresCohostRenderer && !config.cohostRenderer)
                    return null;
                const checkboxId = Math.random().toString(36);
                return (
                    <div className="config-item" key={k}>
                        <div className="item-header">
                            <input
                                id={checkboxId}
                                type="checkbox"
                                checked={
                                    v.inRender ? (config.render as any)[k] : (config as any)[k]
                                }
                                onChange={(e) => {
                                    const value = (e.target as HTMLInputElement).checked;
                                    const newConfig = { ...config };
                                    if (v.inRender) {
                                        newConfig.render = { ...newConfig.render, [k]: value };
                                    } else {
                                        newConfig[k as unknown as keyof PreviewConfig] =
                                            value as any;
                                    }
                                    onConfigChange(newConfig);
                                    if (v.renderOnChange) {
                                        renderContext.scheduleRender();
                                    }
                                }}
                            />{' '}
                            <label htmlFor={checkboxId}>{v.label}</label>
                        </div>
                        <div className="item-description">{v.description}</div>
                    </div>
                );
            })}
        </div>
    );
}

const globalDynamicStyles = (() => {
    // we'll just create two global style tags and set their disabled property,
    // because doing it any other way causes glitches in e.g. Firefox

    const styleMotion = document.createElement('style');
    const styleReduced = document.createElement('style');

    styleMotion.className = styleReduced.className = 'post-dynamic-styles';

    styleMotion.innerHTML = `
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
    `;
    styleReduced.innerHTML = `
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
    `;
    document.head.append(styleMotion, styleReduced);

    const setReducedMotion = (reduced: boolean) => {
        styleMotion.disabled = reduced;
        styleReduced.disabled = !reduced;
    };
    setReducedMotion(false);

    return { setReducedMotion };
})();

function DynamicStyles({ config }: { config: PreviewConfig }) {
    useEffect(() => {
        globalDynamicStyles.setReducedMotion(config.prefersReducedMotion);
    }, [config]);

    return null;
}

function PostSize({ size }: { size: number }) {
    const byteSize = size;

    let sizeLabel;
    if (size < 1000) {
        sizeLabel = size + ' bytes';
    } else {
        size = +(size / 1000).toFixed(2);
        if (size < 1000) {
            sizeLabel = size + ' kB';
        } else {
            size = +(size / 1000).toFixed(2);
            sizeLabel = size + ' MB';
        }
    }

    let sizeOfMax = byteSize / COHOST_APPROX_MAX_PAYLOAD_SIZE;

    return (
        <span
            className="post-size-meter"
            style={
                {
                    '--size-of-max': Math.min(1, sizeOfMax),
                } as any
            }
        >
            {sizeLabel}{' '}
            {sizeOfMax >= 1 ? (
                <span className="i-warning">probably too large</span>
            ) : sizeOfMax >= 0.95 ? (
                <span className="i-warning">close to size limit</span>
            ) : null}
        </span>
    );
}

function CopyToClipboard({ data, label, disabled }: CopyToClipboard.Props) {
    const [copied, setCopied] = useState(false);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [warningsOpen, setWarningsOpen] = useState(false);

    const copy = () => {
        try {
            navigator.clipboard.writeText(data);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 1000);
        } catch (err) {
            alert('Could not copy to clipboard\n\n' + err);
        }
    };

    const tryCopy = () => {
        const warnings = getExportWarnings(data);
        setWarnings(warnings);
        if (warnings.length) {
            setWarningsOpen(true);
        } else {
            copy();
        }
    };

    const button = useRef<HTMLButtonElement>(null);

    return (
        <>
            <button
                ref={button}
                disabled={disabled}
                className={'button-appearance copy-to-clipboard' + (copied ? ' did-copy' : '')}
                onClick={tryCopy}
            >
                {label}
            </button>
            <DirPopover
                anchor={button.current}
                open={warningsOpen}
                onClose={() => setWarningsOpen(false)}
            >
                <div className="copy-to-clipboard-warnings">
                    <ul className="i-warnings">
                        {warnings.map((warning, i) => (
                            <li key={i}>{warning}</li>
                        ))}
                    </ul>
                    <div className="i-buttons">
                        <Button
                            primary
                            run={() => {
                                setWarningsOpen(false);
                            }}
                        >
                            cancel
                        </Button>
                        <Button
                            run={() => {
                                copy();
                                setWarningsOpen(false);
                            }}
                        >
                            copy anyway
                        </Button>
                    </div>
                </div>
            </DirPopover>
        </>
    );
}

namespace CopyToClipboard {
    export interface Props {
        data: string;
        label: string;
        disabled?: boolean;
    }
}
