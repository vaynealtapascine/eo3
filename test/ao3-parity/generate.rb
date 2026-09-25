# Regenerates expected.json by running cases.json through AO3's real sanitizer code.
#
# Downloads the otwarchive files the eo3 port mirrors (at `ref`, default master), installs the
# gem versions pinned in otwarchive's Gemfile.lock, and runs:
#   html: HtmlCleaner#sanitize_value(:content, input)   (a chapter body)
#   css:  WorkSkin#clean_css                            (a Work Skin, prefixed with #workskin)
#
#   ruby test/ao3-parity/generate.rb [ref] [--force]
#
# expected.json is only rewritten when a tracked source file or gem version changed (or with
# --force, e.g. after editing cases.json), so a scheduled run leaves the tree clean otherwise.

require "json"
require "net/http"
require "tmpdir"
require "fileutils"

REPO = "otwcode/otwarchive"
SOURCES = %w[
  config/config.yml
  config/initializers/gem-plugin_config/sanitizer_config.rb
  lib/html_cleaner.rb
  lib/paragraph_maker.rb
  lib/css_cleaner.rb
  lib/otw_sanitize/embed_sanitizer.rb
  lib/otw_sanitize/media_sanitizer.rb
  lib/otw_sanitize/user_class_sanitizer.rb
  app/models/work_skin.rb
].freeze
GEMS = %w[sanitize nokogiri css_parser activesupport addressable crass].freeze

HERE = __dir__
force = ARGV.delete("--force")
ref = ARGV[0] || "master"

def get(url)
  uri = URI(url)
  req = Net::HTTP::Get.new(uri)
  req["Authorization"] = "Bearer #{ENV["GITHUB_TOKEN"]}" if ENV["GITHUB_TOKEN"] && uri.host == "api.github.com"
  res = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |http| http.request(req) }
  raise "GET #{url}: #{res.code}" unless res.is_a?(Net::HTTPSuccess)
  res.body
end

commit = JSON.parse(get("https://api.github.com/repos/#{REPO}/commits/#{ref}"))["sha"]
tree = JSON.parse(get("https://api.github.com/repos/#{REPO}/git/trees/#{commit}?recursive=1"))["tree"]
blobs = SOURCES.to_h { |path| [path, tree.find { |t| t["path"] == path }&.dig("sha") || raise("#{path} missing at #{commit}")] }

lock = get("https://raw.githubusercontent.com/#{REPO}/#{commit}/Gemfile.lock")
gems = GEMS.to_h { |name| [name, lock[/^    #{name} \(([^)]+)\)$/, 1] || raise("#{name} not in Gemfile.lock")] }

expected_path = File.join(HERE, "expected.json")
previous = File.exist?(expected_path) ? JSON.parse(File.read(expected_path)) : {}
if !force && previous["sources"] == blobs && previous["gems"] == gems
  puts "AO3 sources unchanged since #{previous["commit"]}; nothing to do."
  exit
end

src_dir = Dir.mktmpdir("otwarchive")
SOURCES.each do |path|
  dest = File.join(src_dir, path)
  FileUtils.mkdir_p(File.dirname(dest))
  File.write(dest, get("https://raw.githubusercontent.com/#{REPO}/#{commit}/#{path}"))
end

require "bundler/inline"
gemfile(true, quiet: true) do
  source "https://rubygems.org"
  gems.each { |name, version| gem name, version }
  gem "json", JSON::VERSION # already loaded above to read the GitHub API
end

require "yaml"
require "ostruct"
require "active_support/all"
require "sanitize"
require "css_parser"

# Rails' load_defaults sets `Regexp.timeout ||= 1`; css_cleaner.rb treats a timeout as invalid.
Regexp.timeout = 1.0

config = YAML.load_file(File.join(src_dir, "config/config.yml"), aliases: true)
# config.yml ships a placeholder; relative image paths resolve against the live site.
config["APP_URL"] = "https://archiveofourown.org/"
ArchiveConfig = OpenStruct.new(config)

%w[
  config/initializers/gem-plugin_config/sanitizer_config.rb
  lib/otw_sanitize/embed_sanitizer.rb
  lib/otw_sanitize/media_sanitizer.rb
  lib/otw_sanitize/user_class_sanitizer.rb
  lib/paragraph_maker.rb
  lib/html_cleaner.rb
  lib/css_cleaner.rb
].each { |path| load File.join(src_dir, path) }

# Just enough of Skin (an ActiveRecord model) for WorkSkin#clean_css to run unmodified.
class SkinErrors
  attr_reader :keys

  def initialize = @keys = []
  def add(_attribute, key, **) = @keys << key.to_s
end

module SkinCacheHelper; end

class Skin
  include CssCleaner
  attr_accessor :css

  def self.has_many(*) = nil
  def self.after_save(*) = nil
  def errors = @errors ||= SkinErrors.new
end

load File.join(src_dir, "app/models/work_skin.rb")

class HtmlSanitizer
  include HtmlCleaner
end

cases = JSON.parse(File.read(File.join(HERE, "cases.json")))
sanitizer = HtmlSanitizer.new

# Some inputs crash AO3 itself (the post then fails to save); record the exception instead.
def run_case
  yield
rescue StandardError => e
  { "raises" => e.class.name }
end

html = cases["html"].transform_values do |input|
  run_case { sanitizer.sanitize_value(:content, input) }
end
css = cases["css"].transform_values do |input|
  run_case do
    skin = WorkSkin.new
    skin.css = input
    skin.clean_css
    { "css" => skin.css.to_s, "errors" => skin.errors.keys.sort }
  end
end

File.write(expected_path, JSON.pretty_generate(
  "commit" => commit,
  "sources" => blobs,
  "gems" => gems,
  "html" => html,
  "css" => css
) + "\n")
puts "Wrote #{html.size} html + #{css.size} css results from #{REPO}@#{commit[0, 7]}."
FileUtils.rm_rf(src_dir)
