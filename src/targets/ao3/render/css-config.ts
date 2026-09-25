/**
 * The CSS allowlists from otwarchive's `config/config.yml` (`SUPPORTED_CSS_*`,
 * `SUPPORTED_EXTERNAL_URLS`) and the TLD table from `lib/css_cleaner.rb`, as consumed by
 * ./css-cleaner. Pure data.
 */
import { words } from './ruby-str';

/**
 * Properties matched as *substrings* (the Ruby regex is unanchored), so every variant is allowed:
 * `border` admits border-right, border-bottom-left-radius, -moz-border-foo, …; `text` admits
 * text-shadow, text-decoration, …; `column` admits grid-template-columns.
 */
export const SUPPORTED_CSS_SHORTHAND_PROPERTIES: readonly string[] = words(`
    background border column cue flex font layer-background layout-grid list-style margin marker
    outline overflow padding page-break pause scrollbar text transform transition
`);

/** Properties allowed by exact name (or with a -moz-/-ms-/-o-/-webkit- prefix). */
export const SUPPORTED_CSS_PROPERTIES: readonly string[] = words(`
    -replace -use-link-source accelerator accent-color align-content align-items align-self
    alignment-adjust alignment-baseline appearance aspect-ratio azimuth baseline-shift behavior
    binding bookmark-label bookmark-level bookmark-target bottom box-align box-direction box-flex
    box-flex-group box-lines box-orient box-pack box-shadow box-sizing caption-side clear clip
    color color-profile color-scheme content counter-increment counter-reset crop cue cue-after
    cue-before cursor direction display dominant-baseline drop-initial-after-adjust
    drop-initial-after-align drop-initial-before-adjust drop-initial-before-align
    drop-initial-size drop-initial-value elevation empty-cells fill filter fit fit-position float
    float-offset font font-effect font-emphasize font-emphasize-position font-emphasize-style
    font-family font-size font-size-adjust font-smooth font-stretch font-style font-variant
    font-weight grid-columns grid-rows hanging-punctuation height hyphenate-after
    hyphenate-before hyphenate-character hyphenate-lines hyphenate-resource hyphens icon
    image-orientation image-resolution ime-mode include-source inline-box-align justify-content
    layout-flow left letter-spacing line-break line-height line-stacking line-stacking-ruby
    line-stacking-shift line-stacking-strategy mark mark-after mark-before marks
    marquee-direction marquee-play-count marquee-speed marquee-style max-height max-width
    min-height min-width move-to nav-down nav-index nav-left nav-right nav-up opacity order
    orphans page page-policy phonemes pitch pitch-range play-during position presentation-level
    punctuation-trim quotes rendering-intent resize rest rest-after rest-before richness right
    rotation rotation-point ruby-align ruby-overhang ruby-position ruby-span size speak
    speak-header speak-numeral speak-punctuation speech-rate stress string-set stroke
    stroke-width tab-side table-layout target target-name target-new target-position top
    unicode-bibi unicode-bidi user-select vertical-align visibility voice-balance voice-duration
    voice-family voice-pitch voice-pitch-range voice-rate voice-stress voice-volume volume
    white-space white-space-collapse widows width word-break word-spacing word-wrap
    writing-mode z-index
`);

/** Bare keywords accepted as a whole value; `url` here is what enables the `url()` function at all. */
export const SUPPORTED_CSS_KEYWORDS: readonly string[] = ['!important', 'url'];

/** File extensions a `url()` may point at. */
export const SUPPORTED_EXTERNAL_URLS: readonly string[] = ['jpg', 'jpeg', 'png', 'gif'];

/** The hard-coded TLD list a `url()` host must end in (from lib/css_cleaner.rb; notably no newer gTLDs). */
export const TOP_LEVEL_DOMAINS: readonly string[] = words(`
    ac ad ae aero af ag ai al am an ao aq ar arpa as asia at au aw ax az ba bb bd be bf bg bh bi
    biz bj bm bn bo br bs bt bv bw by bz ca cat cc cd cf cg ch ci ck cl cm cn co com coop cr cu
    cv cx cy cz de dj dk dm do dz ec edu ee eg er es et eu fi fj fk fm fo fr ga gb gd ge gf gg gh
    gi gl gm gn gov gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in info int io iq ir is
    it je jm jo jobs jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc
    md me mg mh mil mk ml mm mn mo mobi mp mq mr ms mt mu museum mv mw mx my mz na name nc ne net
    nf ng ni nl no np nr nu nz om org pa pe pf pg ph pk pl pm pn pr pro ps pt pw py qa re ro rs
    ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr st su sv sy sz tc td tel tf tg th tj tk tl
    tm tn to tp tr travel tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws xn xxx ye yt
    za zm zw
`);
