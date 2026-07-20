import React, { useRef, useState } from 'react';
import parse from 'html-react-parser';
import { DirPopover } from '../../uikit/dir-popover';
import { CopyToClipboardButton } from '../../ui/components/post-preview/copy-to-clipboard-button';
import { SiteTargetPreviewProps, ErrorMessage as GenericErrorMessage } from '../types';
import { RenderConfig } from './config';
import { ERRORS, AO3_APPROX_MAX_PAYLOAD_SIZE } from './fallback-renderer';
import { EXPORT_ACTIONS } from './export-actions';

function ErrorList({ errors }: { errors: GenericErrorMessage[] }) {
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

    let sizeOfMax = byteSize / AO3_APPROX_MAX_PAYLOAD_SIZE;

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

export function Ao3PreviewHeader({
    exportOutput,
    error,
    renderErrors,
    asyncErrors,
}: SiteTargetPreviewProps<RenderConfig>) {
    const errorBtn = useRef<HTMLButtonElement>(null);
    const [errorsOpen, setErrorsOpen] = useState(false);

    const errorCount = renderErrors.length + asyncErrors.length;
    const html = exportOutput.get('html') ?? '';

    return (
        <React.Fragment>
        <div className="prose-container ao3-main">
            <div id="outer" className="wrapper inner-prose prose p-prose co-prose ao3-renderer">
                <ul id="skiplinks">
                    <li>
                        <a href="#main">Main Content</a>
                    </li>
                </ul>
                <header id="header" className="region">
                    <h1 className="heading">
                        <a href="/">
                            <span>Archive of Our Own</span>
                        </a>
                    </h1>

                    <nav id="greeting" aria-label="User">
                        <ul className="user navigation actions">
                            <li className="dropdown">
                                <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">
                                    Hi, User!
                                </a>
                                <ul className="menu dropdown-menu">
                                    <li>
                                        <a>My Dashboard</a>
                                    </li>
                                    <li>
                                        <a>My Subscriptions</a>
                                    </li>
                                    <li>
                                        <a>My Works</a>
                                    </li>
                                    <li>
                                        <a>My Bookmarks</a>
                                    </li>
                                    <li>
                                        <a>My History</a>
                                    </li>
                                    <li>
                                        <a>My Preferences</a>
                                    </li>
                                </ul>
                            </li>
                            <li className="dropdown" aria-haspopup="true">
                                <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">
                                    Post
                                </a>
                                <ul className="menu dropdown-menu">
                                    <li>
                                        <a>New Work</a>
                                    </li>
                                    <li>
                                        <a>Import Work</a>
                                    </li>
                                </ul>
                            </li>
                            <li>
                                <a>Log Out</a>
                            </li>
                        </ul>

                        <p className="icon">
                            <a>
                                <img alt="" className="icon" />
                            </a>
                        </p>
                    </nav>

                    <nav aria-label="Site">
                        <ul className="primary navigation actions">
                            <li className="dropdown" aria-haspopup="true">
                                <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">
                                    Fandoms
                                </a>
                                <ul className="menu dropdown-menu">
                                    <li>
                                        <a>All Fandoms</a>
                                    </li>
                                    <li id="medium_5">
                                        <a>Anime &amp; Manga</a>
                                    </li>
                                    <li id="medium_3">
                                        <a>Books &amp; Literature</a>
                                    </li>
                                    <li id="medium_4">
                                        <a>Cartoons &amp; Comics &amp; Graphic Novels</a>
                                    </li>
                                    <li id="medium_7">
                                        <a>Celebrities &amp; Real People</a>
                                    </li>
                                    <li id="medium_2">
                                        <a>Movies</a>
                                    </li>
                                    <li id="medium_6">
                                        <a>Music &amp; Bands</a>
                                    </li>
                                    <li id="medium_8">
                                        <a>Other Media</a>
                                    </li>
                                    <li id="medium_30198">
                                        <a>Theater</a>
                                    </li>
                                    <li id="medium_1">
                                        <a>TV Shows</a>
                                    </li>
                                    <li id="medium_476">
                                        <a>Video Games</a>
                                    </li>
                                    <li id="medium_9971">
                                        <a>Uncategorized Fandoms</a>
                                    </li>
                                </ul>
                            </li>
                            <li className="dropdown" aria-haspopup="true">
                                <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">
                                    Browse
                                </a>
                                <ul className="menu dropdown-menu">
                                    <li>
                                        <a>Works</a>
                                    </li>
                                    <li>
                                        <a>Bookmarks</a>
                                    </li>
                                    <li>
                                        <a>Tags</a>
                                    </li>
                                    <li>
                                        <a>Collections</a>
                                    </li>
                                </ul>
                            </li>
                            <li className="dropdown" aria-haspopup="true">
                                <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">
                                    Search
                                </a>
                                <ul className="menu dropdown-menu">
                                    <li>
                                        <a>Works</a>
                                    </li>
                                    <li>
                                        <a>Bookmarks</a>
                                    </li>
                                    <li>
                                        <a>Tags</a>
                                    </li>
                                    <li>
                                        <a>People</a>
                                    </li>
                                </ul>
                            </li>
                            <li className="dropdown" aria-haspopup="true">
                                <a className="dropdown-toggle" data-toggle="dropdown" data-target="#">
                                    About
                                </a>
                                <ul className="menu dropdown-menu">
                                    <li>
                                        <a>About Us</a>
                                    </li>
                                    <li>
                                        <a>News</a>
                                    </li>
                                    <li>
                                        <a>FAQ</a>
                                    </li>
                                    <li>
                                        <a>Wrangling Guidelines</a>
                                    </li>
                                    <li>
                                        <a href="https://archiveofourown.org/donate" target="_blank">
                                            Donate or Volunteer
                                        </a>
                                    </li>
                                </ul>
                            </li>
                            <li className="search">
                                <form className="search" id="search">
                                    <fieldset>
                                        <p>
                                            <label className="landmark" htmlFor="site_search">
                                                Work Search
                                            </label>
                                            <input
                                                disabled
                                                className="text"
                                                id="site_search"
                                                aria-describedby="site_search_tooltip"
                                                type="text"
                                                name="work_search[query]"
                                            ></input>
                                            <span className="tip" role="tooltip" id="site_search_tooltip">
                                                tip: arthur merlin words&gt;1000 sort:hits
                                            </span>
                                            <span className="submit actions">
                                                <button disabled className="button">
                                                    Search
                                                </button>
                                            </span>
                                        </p>
                                    </fieldset>
                                </form>
                            </li>
                        </ul>
                    </nav>

                    <div className="clear"></div>
                </header>

                <div id="inner" className="wrapper">
                    <div id="main" className="chapters-show region" role="main">
                        <div className="flash"></div>
                        <div className="work">
                            <p className="landmark">
                                <a>&nbsp;</a>
                            </p>
                            <h3 className="landmark heading">Actions</h3>

                            <div>
                                <details open style={{ display: 'table', margin: '0 auto' }}>
                                    <summary
                                        className="action"
                                        style={{ display: 'table', margin: '0 auto' }}
                                    >
                                        Fic Details
                                    </summary>
                                    <div>
                                        <ul className="work navigation actions">
                                            <li className="add">
                                                <a>Add Chapter</a>
                                            </li>
                                            <li className="edit">
                                                <a>Edit</a>
                                            </li>
                                            <li className="edit tag">
                                                <a>Edit Tags</a>
                                            </li>

                                            <li className="chapter entire">
                                                <a>Entire Work</a>
                                            </li>

                                            <li className="chapter previous">
                                                <a>← Previous Chapter</a>
                                            </li>

                                            <li className="chapter next">
                                                <a>Next Chapter →</a>
                                            </li>

                                            <li className="chapter">
                                                <noscript>
                                                    <a>Chapter Index</a>
                                                </noscript>
                                                <button className="collapsed">Chapter Index</button>
                                                <ul id="chapter_index" className="expandable secondary hidden">
                                                    <li>
                                                        <form accept-charset="UTF-8" method="get">
                                                            <p>
                                                                <select name="selected_id" id="selected_id">
                                                                    <option value="1">Chapter 1</option>
                                                                    <option selected value="2">
                                                                        Chapter 2
                                                                    </option>
                                                                    <option value="3">Chapter 3</option>
                                                                </select>
                                                                <span className="submit actions">
                                                                    <input type="submit" name="commit" value="Go" />
                                                                </span>
                                                            </p>
                                                        </form>
                                                    </li>
                                                    <li>
                                                        <a>Full-Page Index</a>
                                                    </li>
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
                                                <a className="modal modal-attached" title="Share Work">
                                                    Share
                                                </a>
                                            </li>

                                            <li className="subscribe">
                                                <form
                                                    className="ajax-create-destroy"
                                                    accept-charset="UTF-8"
                                                    method="post"
                                                >
                                                    <input type="submit" disabled name="commit" value="Subscribe" />
                                                </form>
                                            </li>

                                            <li className="share">
                                                <button className="collapsed">Download</button>
                                            </li>
                                        </ul>
                                        <dl className="wrapper work meta group">
                                            <dt className="rating tags">Rating:</dt>

                                            <dd className="rating tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">Explicit</a>
                                                    </li>
                                                </ul>
                                            </dd>
                                            <dt className="warning tags">
                                                <a>Archive Warning</a>:
                                            </dt>

                                            <dd className="warning tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">
                                                            Creator Chose Not To Use Archive Warnings
                                                        </a>
                                                    </li>
                                                </ul>
                                            </dd>
                                            <dt className="category tags">Categories:</dt>

                                            <dd className="category tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">F/F</a>
                                                    </li>
                                                    <li>
                                                        <a className="tag">Multi</a>
                                                    </li>
                                                    <li>
                                                        <a className="tag">Other</a>
                                                    </li>
                                                </ul>
                                            </dd>
                                            <dt className="fandom tags">Fandom:</dt>

                                            <dd className="fandom tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">Generic Fandom</a>
                                                    </li>
                                                </ul>
                                            </dd>
                                            <dt className="relationship tags">Relationships:</dt>

                                            <dd className="relationship tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">Character A/Character B</a>
                                                    </li>
                                                </ul>
                                            </dd>
                                            <dt className="character tags">Characters:</dt>

                                            <dd className="character tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">Character A</a>
                                                    </li>
                                                    <li>
                                                        <a className="tag">Character B</a>
                                                    </li>
                                                </ul>
                                            </dd>
                                            <dt className="freeform tags">Additional Tags:</dt>

                                            <dd className="freeform tags">
                                                <ul className="commas">
                                                    <li>
                                                        <a className="tag">Slice of Life</a>
                                                    </li>
                                                    <li>
                                                        <a className="tag">Alternate Universe</a>
                                                    </li>
                                                </ul>
                                            </dd>

                                            <dt className="language">Language:</dt>
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
                                        <h2 className="title heading">Fic Title</h2>
                                        <h3 className="byline heading">
                                            <a rel="author">Author Name</a>
                                        </h3>
                                    </div>

                                    <div id="chapters">
                                        <div className="chapter" id="chapter-2">
                                            <h3 className="landmark heading">Chapter Management</h3>
                                            <div className="post-header" style={{ float: 'right', clear: 'left' }}>
                                                <span className="i-errors-container">
                                                    <button
                                                        ref={errorBtn}
                                                        className={
                                                            'i-errors-button action' +
                                                            (errorCount ? ' has-errors' : '')
                                                        }
                                                        disabled={!errorCount}
                                                        onClick={() => setErrorsOpen(true)}
                                                        aria-label={
                                                            errorCount === 1 ? '1 error' : `${errorCount} errors`
                                                        }
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
                                            <button className="action" style={{ float: 'right', marginRight: '8px' }}>
                                                Edit Chapter
                                            </button>

                                            <div className="chapter preface group">
                                                <h3 className="title">
                                                    <a>Chapter 1</a>: Chapter Title
                                                </h3>
                                            </div>

                                            <div className="userstuff module" role="article">
                                                <h3 className="landmark heading" id="work">
                                                    Chapter Text
                                                </h3>
                                                {parse(html)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div id="feedback" className="feedback">
                            <h3 className="landmark heading">Actions</h3>
                            <div className="post-footer-simulate" style={{ float: 'right' }}>
                                <PostSize size={html.length} />
                                {EXPORT_ACTIONS.map((action) => (
                                    <CopyToClipboardButton
                                        key={action.id}
                                        action={action}
                                        exportOutput={exportOutput}
                                        disabled={!!error}
                                    />
                                ))}
                            </div>

                            <div id="kudos_message"></div>

                            <h3 className="landmark heading">Kudos</h3>
                            <div id="kudos">
                                <p className="kudos">
                                    <a href="https://archiveofourown.org/users/vaynegarden">vaynegarden</a> and 39
                                    guests left kudos on this work!
                                </p>
                            </div>

                            <h3 className="landmark heading">
                                <a id="comments">Comments</a>
                            </h3>
                            <div id="add_comment_placeholder" title="top level comment">
                                <div id="add_comment">
                                    <div className="post comment">
                                        <form className="new_comment" accept-charset="UTF-8" method="post">
                                            <input type="hidden" name="authenticity_token" />
                                            <fieldset>
                                                <legend>Post Comment</legend>

                                                <h4 className="heading">
                                                    Comment as{' '}
                                                    <select
                                                        style={{
                                                            pointerEvents: 'none',
                                                        }}
                                                        title="Choose Name"
                                                        name="comment[pseud_id]"
                                                    >
                                                        <option selected>User</option>
                                                    </select>
                                                </h4>

                                                <p className="footnote">
                                                    Plain text with limited HTML{' '}
                                                    <a
                                                        className="help symbol question modal modal-attached"
                                                        aria-label="Html help"
                                                    >
                                                        <span className="symbol question">
                                                            <span>?</span>
                                                        </span>
                                                    </a>
                                                </p>

                                                <p>
                                                    <label className="landmark">Comment</label>
                                                    <textarea
                                                        style={{
                                                            pointerEvents: 'none',
                                                        }}
                                                        className="comment_form observe_textlength"
                                                        title="Enter Comment"
                                                        name="comment[comment_content]"
                                                    ></textarea>
                                                    <span
                                                        role="alert"
                                                        className=" LV_validation_message LV_valid"
                                                    ></span>
                                                    <input type="hidden" name="controller_name" value="chapters" />
                                                </p>
                                                <p className="character_counter">
                                                    <span className="value" data-maxlength="10000">
                                                        1000
                                                    </span>{' '}
                                                    characters left
                                                </p>
                                                <p className="submit actions">
                                                    <input
                                                        disabled
                                                        type="submit"
                                                        name="commit"
                                                        value="Comment"
                                                        data-disable-with="Please wait..."
                                                    />
                                                </p>
                                            </fieldset>
                                        </form>
                                    </div>
                                    <div className="clear"></div>
                                </div>
                            </div>
                            <div id="modal-bg" className="modal-closer">
                                <div className="loading"></div>
                            </div>
                            <div id="modal-wrap" className="modal-closer">
                                <div id="modal">
                                    <div className="content userstuff"></div>
                                    <div className="footer">
                                        <span className="title"></span>
                                        <a className="action modal-closer" href="#">
                                            Close
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <hr />
        </React.Fragment>
    );
}
