Pod::Spec.new do |s|
  s.name = 'GoliathContext'
  s.version = '0.0.1'
  s.summary = 'Native Foundation Models token accounting for the Goliath example.'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Goliath contributors'
  s.homepage = 'https://github.com/hellohelen-ai/goliath'
  s.source = { :git => 'https://github.com/hellohelen-ai/goliath.git' }
  s.platforms = { :ios => '26.0' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
