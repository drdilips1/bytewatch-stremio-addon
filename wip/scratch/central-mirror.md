// Local only: Maven Central answers 404 at random through this sandbox's proxy; Google's mirror of it doesn't.
def mirror = 'https://maven-central.storage-download.googleapis.com/maven2/'
def redirect = { repos ->
    repos.withType(MavenArtifactRepository).configureEach { r ->
        if (r.url.toString().contains('repo.maven.apache.org') || r.url.toString().contains('repo1.maven.org')) r.url = mirror
    }
}
settingsEvaluated { s -> redirect(s.pluginManagement.repositories); redirect(s.dependencyResolutionManagement.repositories) }
allprojects { redirect(buildscript.repositories); redirect(repositories) }
